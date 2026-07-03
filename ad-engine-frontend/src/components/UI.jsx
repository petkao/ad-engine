import { useState } from 'react';

// ── Stat Card ────────────────────────────────────────────────
export function StatCard({ label, value, icon, color = 'blue' }) {
  const colors = {
    blue:   'bg-blue-50 text-blue-600 border-blue-100',
    amber:  'bg-amber-50 text-amber-600 border-amber-100',
    green:  'bg-green-50 text-green-600 border-green-100',
    purple: 'bg-purple-50 text-purple-600 border-purple-100',
  };
  return (
    <div className={`rounded-2xl border p-5 flex items-center gap-4 ${colors[color]}`}>
      <div className="text-3xl">{icon}</div>
      <div>
        <div className="text-2xl font-bold">{value}</div>
        <div className="text-sm font-medium opacity-70">{label}</div>
      </div>
    </div>
  );
}

// ── Badge ─────────────────────────────────────────────────────
export function Badge({ children, variant = 'default' }) {
  const variants = {
    default:   'bg-slate-100 text-slate-600',
    active:    'bg-green-100 text-green-700',
    inactive:  'bg-red-100 text-red-700',
    pro:       'bg-blue-100 text-blue-700',
    starter:   'bg-slate-100 text-slate-600',
    enterprise:'bg-purple-100 text-purple-700',
    rejected:  'bg-red-100 text-red-700',
    pending_review: 'bg-amber-100 text-amber-700',
    paused:    'bg-slate-100 text-slate-500',
    video:     'bg-indigo-100 text-indigo-700',
    image:     'bg-green-100 text-green-700',
    text:      'bg-slate-100 text-slate-600',
    native:    'bg-blue-100 text-blue-700',
    carousel:  'bg-purple-100 text-purple-700',
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${variants[variant] || variants.default}`}>
      {children}
    </span>
  );
}

// ── Button ────────────────────────────────────────────────────
export function Button({ children, onClick, variant = 'primary', size = 'md', disabled, className = '' }) {
  const variants = {
    primary:   'bg-blue-600 hover:bg-blue-700 text-white shadow-sm',
    secondary: 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-200',
    danger:    'bg-red-500 hover:bg-red-600 text-white',
    ghost:     'hover:bg-slate-100 text-slate-600',
  };
  const sizes = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2 text-sm',
    lg: 'px-6 py-3 text-base',
  };
  return (
    <button onClick={onClick} disabled={disabled}
      className={`rounded-lg font-medium transition-all duration-150 disabled:opacity-40 ${variants[variant]} ${sizes[size]} ${className}`}>
      {children}
    </button>
  );
}

// ── Modal ─────────────────────────────────────────────────────
export function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-slate-100">
          <h2 className="text-lg font-semibold text-slate-800">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

// ── Form Field ────────────────────────────────────────────────
export function Field({ label, children }) {
  return (
    <div className="mb-4">
      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">{label}</label>
      {children}
    </div>
  );
}

export function Input({ value, onChange, placeholder, type = 'text', ...props }) {
  return (
    <input type={type} value={value} onChange={onChange} placeholder={placeholder}
      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
      {...props} />
  );
}

export function Select({ value, onChange, children }) {
  return (
    <select value={value} onChange={onChange}
      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
      {children}
    </select>
  );
}

export function Textarea({ value, onChange, placeholder, rows = 3 }) {
  return (
    <textarea value={value} onChange={onChange} placeholder={placeholder} rows={rows}
      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
  );
}

// ── Sortable Table ────────────────────────────────────────────
export function Table({ columns, data, onEdit, onDelete }) {
  const [sortKey, setSortKey]   = useState(null);
  const [sortDir, setSortDir]   = useState('asc');

  // Check if columns already includes an actions column
  const hasActionsColumn = columns.some(c => c.key === 'actions');

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const sorted = [...data].sort((a, b) => {
    if (!sortKey) return 0;
    const col = columns.find(c => c.key === sortKey);
    if (col?.sortable === false) return 0;
    let aVal = a[sortKey];
    let bVal = b[sortKey];
    // Handle numeric strings
    if (!isNaN(parseFloat(aVal)) && !isNaN(parseFloat(bVal))) {
      aVal = parseFloat(aVal);
      bVal = parseFloat(bVal);
    } else {
      aVal = String(aVal || '').toLowerCase();
      bVal = String(bVal || '').toLowerCase();
    }
    if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
    if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  if (!data.length) return (
    <div className="text-center py-16 text-slate-400">
      <div className="text-4xl mb-3">📭</div>
      <div className="text-sm">No records found</div>
    </div>
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100">
            {columns.map(c => (
              <th key={c.key}
                onClick={() => c.sortable !== false && handleSort(c.key)}
                className={`text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wide select-none
                  ${c.sortable !== false ? 'cursor-pointer hover:text-slate-600' : ''}`}>
                <span className="flex items-center gap-1">
                  {c.label}
                  {c.sortable !== false && (
                    <span className="text-slate-300">
                      {sortKey === c.key ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
                    </span>
                  )}
                </span>
              </th>
            ))}
            {!hasActionsColumn && (onEdit || onDelete) && (
              <th className="text-right py-3 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wide">Actions</th>
            )}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr key={row.id || i} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
              {columns.map(c => (
                <td key={c.key} className="py-3 px-4 text-slate-700">
                  {c.render ? c.render(row[c.key], row) : row[c.key]}
                </td>
              ))}
              {!hasActionsColumn && (onEdit || onDelete) && (
                <td className="py-3 px-4 text-right">
                  <div className="flex items-center justify-end gap-2">
                    {onEdit && <Button variant="ghost" size="sm" onClick={() => onEdit(row)}>✏️ Edit</Button>}
                    {onDelete && <Button variant="danger" size="sm" onClick={() => onDelete(row.id)}>🗑️ Delete</Button>}
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Search Bar ────────────────────────────────────────────────
export function SearchBar({ value, onChange, placeholder = 'Search...' }) {
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">🔍</span>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-500" />
    </div>
  );
}

// ── Loading Spinner ───────────────────────────────────────────
export function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
    </div>
  );
}

// ── Page Header ───────────────────────────────────────────────
export function PageHeader({ title, subtitle, action }) {
  return (
    <div className="flex items-start justify-between mb-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500 mt-1">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
