import { useState } from 'react';
import Dashboard from './pages/Dashboard';
import Sellers from './pages/Sellers';
import Products from './pages/Products';
import Ads from './pages/Ads';
import Buyers from './pages/Buyers';

const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: '⚡' },
  { id: 'sellers',   label: 'Sellers',   icon: '🏪' },
  { id: 'products',  label: 'Products',  icon: '📦' },
  { id: 'ads',       label: 'Ads',       icon: '📢' },
  { id: 'buyers',    label: 'Buyers',    icon: '👥' },
];

const PAGES = { dashboard: Dashboard, sellers: Sellers, products: Products, ads: Ads, buyers: Buyers };

export default function App() {
  const [page, setPage] = useState('dashboard');
  const Page = PAGES[page];
  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      <aside className="w-56 bg-white border-r border-slate-100 flex flex-col shrink-0">
        <div className="px-5 py-6 border-b border-slate-100">
          <div className="text-lg font-bold text-slate-800" style={{ fontFamily: '"DM Serif Display", serif' }}>Ad Engine</div>
          <div className="text-xs text-slate-400 mt-0.5">Peter Kao Associates</div>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV.map(item => (
            <button key={item.id} onClick={() => setPage(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                page === item.id ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}>
              <span>{item.icon}</span><span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="px-4 py-4 border-t border-slate-100">
          <div className="text-xs text-slate-400">
            <div className="font-medium text-slate-500 mb-1">Stack</div>
            <div>React · Node.js · PostgreSQL</div>
            <div className="mt-1 text-green-500 flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-green-500 rounded-full inline-block" />Connected
            </div>
          </div>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-8 py-8"><Page /></div>
      </main>
    </div>
  );
}
