/**
 * ProductWorkspace - Container for product-scoped creative workflow
 * Manages tabs: Overview, Knowledge, Campaigns, Assets
 */
import { useEffect, useState, useCallback } from 'react';
import { api } from '../api/client';
import { PageHeader, Button } from '../components/UI';
import WorkspaceTabs from './workspace/WorkspaceTabs';
import OverviewTab from './workspace/OverviewTab';
import KnowledgeTab from './workspace/KnowledgeTab';
import CampaignsTab from './workspace/CampaignsTab';
import AssetsTab from './workspace/AssetsTab';

export default function ProductWorkspace({
  product,
  initialTab = 'overview',
  onBack,
  onStartWizard,
}) {
  const [activeTab, setActiveTab] = useState(initialTab);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Workspace data
  const [stats, setStats] = useState(null);
  const [briefs, setBriefs] = useState([]);
  const [scripts, setScripts] = useState([]);
  const [storyboards, setStoryboards] = useState([]);

  // Memoized data loader to satisfy useEffect dependency
  const loadWorkspaceData = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      // Load all data in parallel
      const [statsData, briefsData, scriptsData, storyboardsData] = await Promise.all([
        api.getCreativeProductStats(product.id),
        api.getCreativeProductBriefs(product.id),
        api.getCreativeProductScripts(product.id),
        api.getCreativeProductStoryboards(product.id),
      ]);

      setStats(statsData);
      setBriefs(briefsData);
      setScripts(scriptsData);
      setStoryboards(storyboardsData);
    } catch (err) {
      console.error('Error loading workspace data:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [product.id]);

  useEffect(() => {
    loadWorkspaceData();
  }, [loadWorkspaceData]);

  const handleStartNewBrief = () => {
    // Start wizard with this product pre-selected
    onStartWizard(product);
  };

  const handleContinueBrief = (brief) => {
    // Continue workflow from where brief left off
    onStartWizard(product, brief);
  };

  const handleViewBrief = (brief) => {
    // For now, just show in Knowledge tab
    setActiveTab('knowledge');
  };

  // Handle storyboard status change from AssetsTab detail modal
  const handleStoryboardStatusChange = (storyboardId, newStatus) => {
    // Update local storyboards state without full reload
    setStoryboards(prev =>
      prev.map(sb =>
        sb.id === storyboardId ? { ...sb, status: newStatus } : sb
      )
    );
    // Update stats if storyboard was approved
    if (newStatus === 'approved') {
      setStats(prev => prev ? {
        ...prev,
        approvedStoryboardCount: (prev.approvedStoryboardCount || 0) + 1
      } : prev);
    }
  };

  return (
    <div>
      <PageHeader
        title={product.title}
        subtitle="Product Workspace"
        action={
          <Button variant="secondary" onClick={onBack}>
            Back to Dashboard
          </Button>
        }
      />

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl mb-6">
          {error}
          <button
            onClick={loadWorkspaceData}
            className="ml-2 underline hover:no-underline"
          >
            Retry
          </button>
        </div>
      )}

      <WorkspaceTabs activeTab={activeTab} onTabChange={setActiveTab} />

      {activeTab === 'overview' && (
        <OverviewTab
          product={product}
          stats={stats}
          briefs={briefs}
          loading={loading}
          onStartNewBrief={handleStartNewBrief}
          onContinueBrief={handleContinueBrief}
        />
      )}

      {activeTab === 'knowledge' && (
        <KnowledgeTab briefs={briefs} loading={loading} />
      )}

      {activeTab === 'campaigns' && (
        <CampaignsTab
          briefs={briefs}
          loading={loading}
          onContinueBrief={handleContinueBrief}
          onViewBrief={handleViewBrief}
          onStartNew={handleStartNewBrief}
        />
      )}

      {activeTab === 'assets' && (
        <AssetsTab
          scripts={scripts}
          storyboards={storyboards}
          loading={loading}
          onStoryboardStatusChange={handleStoryboardStatusChange}
        />
      )}
    </div>
  );
}
