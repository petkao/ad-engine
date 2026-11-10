/**
 * WorkspaceTabs - Tab navigation for Product Workspace
 */
export default function WorkspaceTabs({ activeTab, onTabChange }) {
  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'knowledge', label: 'Knowledge' },
    { id: 'campaigns', label: 'Campaigns' },
    { id: 'assets', label: 'Assets' },
  ];

  return (
    <div className="flex border-b border-slate-200 mb-6">
      {tabs.map(tab => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={`px-4 py-3 text-sm font-medium border-b-2 transition-all ${
            activeTab === tab.id
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
