import React, { useState, useEffect, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from 'firebase/auth';
import { getFirestore, collection, addDoc, onSnapshot, doc, deleteDoc, writeBatch } from 'firebase/firestore';

// --- Firebase Configuration ---
// These global variables are provided by the environment.
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

// --- Helper Functions ---
const formatDate = (date) => {
    if (!date) return '';
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const toTitleCase = (str) => {
    if (!str) return '';
    return str.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
};


// --- Notification Component ---
function Notification({ message, type, onclose }) {
    useEffect(() => {
        const timer = setTimeout(() => {
            onclose();
        }, 3000); // Notification disappears after 3 seconds
        return () => clearTimeout(timer);
    }, [onclose]);

    const baseStyle = "fixed top-5 right-5 p-4 rounded-lg shadow-lg text-white transition-transform transform translate-x-0";
    const typeStyle = type === 'success' ? 'bg-green-500' : 'bg-red-500';

    return (
        <div className={`${baseStyle} ${typeStyle}`}>
            {message}
        </div>
    );
}


// --- Main App Component ---
export default function App() {
    // --- State Management ---
    const [db, setDb] = useState(null);
    const [userId, setUserId] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false);
    const [currentView, setCurrentView] = useState('form');

    // Data state
    const [names, setNames] = useState([]);
    const [commodities, setCommodities] = useState([]);
    const [entries, setEntries] = useState([]);
    const [notification, setNotification] = useState({ show: false, message: '', type: 'success' });

    // --- Firebase Initialization and Auth ---
    useEffect(() => {
        try {
            const app = initializeApp(firebaseConfig);
            const firestore = getFirestore(app);
            const authInstance = getAuth(app);
            setDb(firestore);

            const unsubscribe = onAuthStateChanged(authInstance, async (user) => {
                if (user) {
                    setUserId(user.uid);
                } else {
                    try {
                        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
                            await signInWithCustomToken(authInstance, __initial_auth_token);
                        } else {
                            await signInAnonymously(authInstance);
                        }
                    } catch (error) {
                        console.error("Error during sign-in:", error);
                    }
                }
                setIsAuthReady(true);
            });
            return () => unsubscribe();
        } catch (error) {
            console.error("Firebase initialization failed:", error);
        }
    }, []);

    // --- Data Fetching from Firestore ---
    useEffect(() => {
        if (isAuthReady && db && userId) {
            const commonPath = `artifacts/${appId}/users/${userId}`;
            // Fetch Names, Commodities, and Entries
            const unsubNames = onSnapshot(collection(db, `${commonPath}/names`), snap => setNames(snap.docs.map(d => d.data().name)));
            const unsubCommodities = onSnapshot(collection(db, `${commonPath}/commodities`), snap => setCommodities(snap.docs.map(d => d.data().name)));
            const unsubEntries = onSnapshot(collection(db, `${commonPath}/entries`), snap => setEntries(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
            
            return () => { unsubNames(); unsubCommodities(); unsubEntries(); };
        }
    }, [db, userId, isAuthReady, appId]);

    const showNotification = (message, type = 'success') => {
        setNotification({ show: true, message, type });
    };

    // --- UI Rendering ---
    return (
        <div className="bg-gray-50 min-h-screen font-sans">
            {notification.show && <Notification message={notification.message} type={notification.type} onclose={() => setNotification({ ...notification, show: false })} />}
            <div className="container mx-auto p-4 sm:p-6 lg:p-8">
                <header className="bg-white shadow-md rounded-xl p-6 mb-8">
                    <h1 className="text-4xl font-bold text-gray-800 text-center">Food Brokerage Manager</h1>
                    <nav className="flex justify-center items-center mt-4 space-x-4">
                        <button onClick={() => setCurrentView('form')} className={`nav-button ${currentView === 'form' ? 'active' : ''}`}>Data Entry</button>
                        <button onClick={() => setCurrentView('balanceSheet')} className={`nav-button ${currentView === 'balanceSheet' ? 'active' : ''}`}>Balance Sheet Viewer</button>
                    </nav>
                </header>
                <main>
                    {currentView === 'form' && <DataEntryForm db={db} userId={userId} names={names} commodities={commodities} showNotification={showNotification} />}
                    {currentView === 'balanceSheet' && <BalanceSheetViewer entries={entries} db={db} userId={userId} showNotification={showNotification} />}
                </main>
            </div>
            <style>{`.nav-button { padding: 0.5rem 1.5rem; border-radius: 0.5rem; font-weight: 600; transition: all 0.3s; } .nav-button.active { background-color: #2563EB; color: white; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1); } .nav-button:not(.active) { background-color: #E5E7EB; color: #374151; } .nav-button:not(.active):hover { background-color: #D1D5DB; }`}</style>
        </div>
    );
}

// --- Data Entry Form Component ---
function DataEntryForm({ db, userId, names, commodities, showNotification }) {
    const initialState = {
        buyerName: '', sellerName: '', deliveryDate: '', commodity: '',
        gstAmount: '', lorryAdvance: '', total: '', lessBillAmount: '',
        onAmount: '', quintalRate: '', quintalAmount: '',
        buyerBrokerage: '', sellerBrokerage: ''
    };
    const [formData, setFormData] = useState(initialState);
    const [isBrokerageLocked, setIsBrokerageLocked] = useState(false);

    // Auto-calculate 'On Amount'
    useEffect(() => {
        const total = parseFloat(formData.total) || 0;
        const lessBill = parseFloat(formData.lessBillAmount) || 0;
        setFormData(prev => ({ ...prev, onAmount: (total - lessBill).toFixed(2) }));
    }, [formData.total, formData.lessBillAmount]);

    // Auto-calculate Brokerage based on Commodity
    useEffect(() => {
        const commodity = formData.commodity.toLowerCase().trim();
        const quintalAmount = parseFloat(formData.quintalAmount) || 0;
        const total = parseFloat(formData.total) || 0;
        
        if (commodity === 'turmeric') {
            setIsBrokerageLocked(true);
            setFormData(prev => ({
                ...prev,
                buyerBrokerage: (quintalAmount * 25).toFixed(2),
                sellerBrokerage: (quintalAmount * 25).toFixed(2)
            }));
        } else if (commodity === 'chillies') {
            setIsBrokerageLocked(true);
            setFormData(prev => ({
                ...prev,
                buyerBrokerage: '0.00',
                sellerBrokerage: (total * 0.005).toFixed(2)
            }));
        } else {
            setIsBrokerageLocked(false);
        }
    }, [formData.commodity, formData.quintalAmount, formData.total]);

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const saveItemIfNotExists = async (itemName, collectionName, list) => {
        if (!db || !userId || !itemName) return;
        const formattedName = toTitleCase(itemName.trim());
        if (!list.find(item => item.toLowerCase() === formattedName.toLowerCase())) {
            try {
                const colPath = `artifacts/${appId}/users/${userId}/${collectionName}`;
                await addDoc(collection(db, colPath), { name: formattedName });
            } catch (error) {
                console.error(`Error saving new ${collectionName}:`, error);
            }
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!db || !userId) return;

        await saveItemIfNotExists(formData.buyerName, 'names', names);
        await saveItemIfNotExists(formData.sellerName, 'names', names);
        await saveItemIfNotExists(formData.commodity, 'commodities', commodities);

        try {
            const entriesColPath = `artifacts/${appId}/users/${userId}/entries`;
            await addDoc(collection(db, entriesColPath), {
                ...formData,
                commodity: toTitleCase(formData.commodity.trim()), // Save standardized commodity name
                createdAt: new Date().toISOString()
            });
            setFormData(initialState);
            showNotification("Entry saved successfully!");
        } catch (error) {
            console.error("Error saving entry:", error);
            showNotification("Failed to save entry. Check console for details.", "error");
        }
    };

    return (
        <div className="bg-white p-8 rounded-xl shadow-lg">
            <form onSubmit={handleSubmit} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div><label htmlFor="buyerName" className="label-style">Buyer Name</label><input list="names-list" id="buyerName" name="buyerName" value={formData.buyerName} onChange={handleInputChange} className="input-style" required /></div>
                    <div><label htmlFor="sellerName" className="label-style">Seller Name</label><input list="names-list" id="sellerName" name="sellerName" value={formData.sellerName} onChange={handleInputChange} className="input-style" required /></div>
                    <div><label htmlFor="commodity" className="label-style">Commodity</label><input list="commodities-list" id="commodity" name="commodity" value={formData.commodity} onChange={handleInputChange} className="input-style" required /></div>
                </div>
                <datalist id="names-list">{names.map(name => <option key={name} value={name} />)}</datalist>
                <datalist id="commodities-list">{commodities.map(c => <option key={c} value={c} />)}</datalist>
                <hr/>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    <div><label htmlFor="deliveryDate" className="label-style">Delivery Date</label><input type="date" id="deliveryDate" name="deliveryDate" value={formData.deliveryDate} onChange={handleInputChange} className="input-style" required /></div>
                    <div><label htmlFor="quintalAmount" className="label-style">Quintal Amount</label><input type="number" step="0.01" id="quintalAmount" name="quintalAmount" value={formData.quintalAmount} onChange={handleInputChange} className="input-style" placeholder="0.00" /></div>
                    <div><label htmlFor="gstAmount" className="label-style">GST Amount</label><input type="number" step="0.01" id="gstAmount" name="gstAmount" value={formData.gstAmount} onChange={handleInputChange} className="input-style" placeholder="0.00" /></div>
                    <div><label htmlFor="lorryAdvance" className="label-style">Lorry Advance</label><input type="number" step="0.01" id="lorryAdvance" name="lorryAdvance" value={formData.lorryAdvance} onChange={handleInputChange} className="input-style" placeholder="0.00" /></div>
                </div>
                <hr/>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    <div><label htmlFor="total" className="label-style">Total</label><input type="number" step="0.01" id="total" name="total" value={formData.total} onChange={handleInputChange} className="input-style" placeholder="0.00" required /></div>
                    <div><label htmlFor="lessBillAmount" className="label-style">Less Bill Amount</label><input type="number" step="0.01" id="lessBillAmount" name="lessBillAmount" value={formData.lessBillAmount} onChange={handleInputChange} className="input-style" placeholder="0.00" /></div>
                    <div><label htmlFor="onAmount" className="label-style">On Amount</label><input type="number" id="onAmount" name="onAmount" value={formData.onAmount} className="input-style bg-gray-200" readOnly /></div>
                    <div><label htmlFor="quintalRate" className="label-style">Quintal Rate</label><input type="number" step="0.01" id="quintalRate" name="quintalRate" value={formData.quintalRate} onChange={handleInputChange} className="input-style" placeholder="0.00" /></div>
                </div>
                 <hr/>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div><label htmlFor="buyerBrokerage" className="label-style">Buyer Brokerage</label><input type="number" step="0.01" id="buyerBrokerage" name="buyerBrokerage" value={formData.buyerBrokerage} onChange={handleInputChange} className={`input-style ${isBrokerageLocked ? 'bg-gray-200' : ''}`} placeholder="0.00" readOnly={isBrokerageLocked} /></div>
                    <div><label htmlFor="sellerBrokerage" className="label-style">Seller Brokerage</label><input type="number" step="0.01" id="sellerBrokerage" name="sellerBrokerage" value={formData.sellerBrokerage} onChange={handleInputChange} className={`input-style ${isBrokerageLocked ? 'bg-gray-200' : ''}`} placeholder="0.00" readOnly={isBrokerageLocked} /></div>
                </div>
                <div className="flex justify-end pt-4"><button type="submit" className="px-8 py-3 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-transform transform hover:scale-105">Save Entry</button></div>
            </form>
            <style>{`.label-style { display: block; margin-bottom: 0.25rem; font-size: 0.875rem; font-weight: 500; color: #374151; } .input-style { width: 100%; padding: 0.5rem 0.75rem; border: 1px solid #D1D5DB; border-radius: 0.5rem; transition: box-shadow 0.15s, border-color 0.15s; } .input-style:focus { outline: none; border-color: #3B82F6; box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.4); }`}</style>
        </div>
    );
}

// --- Balance Sheet Viewer Component ---
function BalanceSheetViewer({ entries, db, userId, showNotification }) {
    const [filters, setFilters] = useState({ startDate: '', endDate: '', buyerName: '', sellerName: '' });
    const [selectedEntries, setSelectedEntries] = useState([]);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

    const handleFilterChange = (e) => setFilters(prev => ({ ...prev, [e.target.name]: e.target.value }));

    const handleSelectEntry = (id) => {
        setSelectedEntries(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
    };
    
    const handleSelectAll = (e) => {
        if (e.target.checked) {
            setSelectedEntries(filteredEntries.map(entry => entry.id));
        } else {
            setSelectedEntries([]);
        }
    };

    const filteredEntries = useMemo(() => {
        return entries.filter(entry => {
            const entryDate = new Date(entry.deliveryDate);
            const startDate = filters.startDate ? new Date(filters.startDate) : null;
            const endDate = filters.endDate ? new Date(filters.endDate) : null;
            if (startDate && entryDate < startDate) return false;
            if (endDate && entryDate > endDate) return false;
            if (filters.buyerName && !entry.buyerName.toLowerCase().includes(filters.buyerName.toLowerCase())) return false;
            if (filters.sellerName && !entry.sellerName.toLowerCase().includes(filters.sellerName.toLowerCase())) return false;
            return true;
        });
    }, [entries, filters]);

    const exportToCSV = () => {
        if (filteredEntries.length === 0) {
            showNotification("No data to export.", "error");
            return;
        }

        const sanitizeCSVField = (field) => {
            let value = field === null || field === undefined ? '' : String(field);
            // If the field contains a comma, double quote, or newline, wrap it in double quotes.
            if (/[",\n]/.test(value)) {
                // Escape any existing double quotes by doubling them.
                value = `"${value.replace(/"/g, '""')}"`;
            }
            return value;
        };

        const headers = [
            'Delivery Date', 'Buyer', 'Seller', 'Commodity', 'GST Amount', 'Lorry Advance', 
            'Total', 'Less Bill Amount', 'On Amount', 'Quintal Rate', 'Quintal Amount', 
            'Buyer Brokerage', 'Seller Brokerage'
        ];

        const rows = filteredEntries.map(entry => {
            const rowData = [
                formatDate(entry.deliveryDate),
                entry.buyerName,
                entry.sellerName,
                entry.commodity,
                entry.gstAmount,
                entry.lorryAdvance,
                entry.total,
                entry.lessBillAmount,
                entry.onAmount,
                entry.quintalRate,
                entry.quintalAmount,
                entry.buyerBrokerage,
                entry.sellerBrokerage
            ];
            return rowData.map(sanitizeCSVField).join(',');
        });

        const csvContent = [headers.join(','), ...rows].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        if (link.download !== undefined) { // feature detection
            const url = URL.createObjectURL(blob);
            link.setAttribute("href", url);
            link.setAttribute("download", "balance_sheet.csv");
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            showNotification("CSV export started successfully!");
        } else {
             showNotification("CSV export is not supported in this preview.", "error");
        }
    };
    
    const handleDelete = async () => {
        if (!db || !userId || selectedEntries.length === 0) return;
        const batch = writeBatch(db);
        selectedEntries.forEach(id => {
            const docRef = doc(db, `artifacts/${appId}/users/${userId}/entries`, id);
            batch.delete(docRef);
        });
        try {
            await batch.commit();
            setSelectedEntries([]);
            setShowDeleteConfirm(false);
            showNotification(`${selectedEntries.length} entries deleted successfully.`);
        } catch (error) {
            console.error("Error deleting entries:", error);
            showNotification("Failed to delete entries. Check console for details.", "error");
        }
    };

    return (
        <div className="bg-white p-8 rounded-xl shadow-lg space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
                {/* Filters */}
                <div><label className="label-style">Start Date</label><input type="date" name="startDate" value={filters.startDate} onChange={handleFilterChange} className="input-style" /></div>
                <div><label className="label-style">End Date</label><input type="date" name="endDate" value={filters.endDate} onChange={handleFilterChange} className="input-style" /></div>
                <div><label className="label-style">Buyer Name</label><input type="text" name="buyerName" placeholder="Filter by buyer..." value={filters.buyerName} onChange={handleFilterChange} className="input-style" /></div>
                <div><label className="label-style">Seller Name</label><input type="text" name="sellerName" placeholder="Filter by seller..." value={filters.sellerName} onChange={handleFilterChange} className="input-style" /></div>
            </div>
            <div className="flex justify-between items-center">
                 <button onClick={exportToCSV} className="action-button bg-green-600 hover:bg-green-700 focus:ring-green-500">Export to CSV</button>
                 {selectedEntries.length > 0 && (
                    <button onClick={() => setShowDeleteConfirm(true)} className="action-button bg-red-600 hover:bg-red-700 focus:ring-red-500">Delete ({selectedEntries.length}) Selected</button>
                 )}
            </div>
            <div className="overflow-x-auto"><table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50"><tr>
                    <th className="th-style w-4"><input type="checkbox" onChange={handleSelectAll} checked={selectedEntries.length > 0 && selectedEntries.length === filteredEntries.length} /></th>
                    <th className="th-style">Date</th><th className="th-style">Buyer</th><th className="th-style">Seller</th>
                    <th className="th-style">Commodity</th><th className="th-style text-right">Total</th><th className="th-style text-right">On Amt</th>
                    <th className="th-style text-right">Buyer Brokerage</th><th className="th-style text-right">Seller Brokerage</th>
                </tr></thead>
                <tbody className="bg-white divide-y divide-gray-200">
                    {filteredEntries.map(entry => (
                        <tr key={entry.id} className={selectedEntries.includes(entry.id) ? 'bg-blue-50' : ''}>
                            <td className="td-style"><input type="checkbox" checked={selectedEntries.includes(entry.id)} onChange={() => handleSelectEntry(entry.id)} /></td>
                            <td className="td-style">{formatDate(entry.deliveryDate)}</td><td className="td-style">{entry.buyerName}</td>
                            <td className="td-style">{entry.sellerName}</td><td className="td-style">{entry.commodity}</td>
                            <td className="td-style text-right">{parseFloat(entry.total || 0).toFixed(2)}</td><td className="td-style text-right">{parseFloat(entry.onAmount || 0).toFixed(2)}</td>
                            <td className="td-style text-right">{parseFloat(entry.buyerBrokerage || 0).toFixed(2)}</td><td className="td-style text-right">{parseFloat(entry.sellerBrokerage || 0).toFixed(2)}</td>
                        </tr>
                    ))}
                </tbody>
            </table></div>
            {showDeleteConfirm && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg p-8 shadow-2xl max-w-sm w-full">
                        <h3 className="text-xl font-bold text-gray-800">Confirm Deletion</h3>
                        <p className="text-gray-600 mt-2">Are you sure you want to permanently delete {selectedEntries.length} selected entries? This action cannot be undone.</p>
                        <div className="flex justify-end space-x-4 mt-6">
                            <button onClick={() => setShowDeleteConfirm(false)} className="px-4 py-2 rounded-lg bg-gray-200 text-gray-800 hover:bg-gray-300 font-semibold">Cancel</button>
                            <button onClick={handleDelete} className="px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 font-semibold">Delete</button>
                        </div>
                    </div>
                </div>
            )}
            <style>{`
                .th-style { padding: 0.75rem 1rem; text-align: left; font-size: 0.75rem; font-weight: 600; color: #374151; text-transform: uppercase; letter-spacing: 0.05em; }
                .td-style { padding: 0.75rem 1rem; font-size: 0.875rem; color: #1F2937; white-space: nowrap; }
                .action-button { padding: 0.5rem 1rem; font-weight: 600; color: white; border-radius: 0.5rem; box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05); transition: background-color 0.2s; }
                .action-button:focus { outline: none; ring: 2px; ring-offset: 2px; }
            `}</style>
        </div>
    );
}

