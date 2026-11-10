/**
 * CampaignsTab - Brief/campaign history for a product
 */
import { Badge, Button, Spinner } from '../../components/UI';

const toneColors = {
  inspirational: 'bg-purple-100 text-purple-700',
  humorous: 'bg-yellow-100 text-yellow-700',
  urgent: 'bg-red-100 text-red-700',
  educational: 'bg-blue-100 text-blue-700',
  emotional: 'bg-pink-100 text-pink-700',
  aspirational: 'bg-indigo-100 text-indigo-700',
};

function BriefCard({ brief, onContinue, onView }) {
  const hasAnalysis = !!brief.product_analysis;
  const hasCampaign = brief.selected_campaign_index !== null && brief.campaign_concepts;
  const selectedCampaign = hasCampaign ? brief.campaign_concepts[brief.selected_campaign_index] : null;

  const getStatus = () => {
    if (brief.status === 'completed') return { label: 'Completed', color: 'bg-green-100 text-green-700' };
    if (hasCampaign) return { label: 'Campaign Selected', color: 'bg-blue-100 text-blue-700' };
    if (hasAnalysis) return { label: 'Analyzed', color: 'bg-yellow-100 text-yellow-700' };
    return { label: 'Draft', color: 'bg-slate-100 text-slate-600' };
  };

  const status = getStatus();
  const canContinue = hasAnalysis && !hasCampaign;

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex items-start justify-between mb-3">
        <div>
          <span className="text-xs text-slate-400">
            {new Date(brief.created_at).toLocaleString()}
          </span>
          <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${status.color}`}>
            {status.label}
          </span>
        </div>
        <span className="text-xs text-slate-400">ID: {brief.id.slice(0, 8)}</span>
      </div>

      {selectedCampaign && (
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-1">
            <h4 className="font-semibold text-slate-800">{selectedCampaign.conceptName}</h4>
            <span className={`text-xs px-2 py-0.5 rounded-full ${toneColors[selectedCampaign.tone] || 'bg-slate-100 text-slate-700'}`}>
              {selectedCampaign.tone}
            </span>
          </div>
          <p className="text-blue-600 italic text-sm">"{selectedCampaign.tagline}"</p>
        </div>
      )}

      {hasAnalysis && !selectedCampaign && (
        <div className="mb-4">
          <p className="text-sm text-slate-600">
            <span className="font-medium">Product:</span> {brief.product_analysis.productName}
          </p>
          <p className="text-sm text-slate-500">
            {brief.campaign_concepts?.length || 0} campaign concepts generated
          </p>
        </div>
      )}

      {/* Campaign Concepts Preview (collapsed) */}
      {brief.campaign_concepts && brief.campaign_concepts.length > 0 && (
        <details className="mb-4">
          <summary className="text-sm text-slate-500 cursor-pointer hover:text-slate-700">
            View all {brief.campaign_concepts.length} concepts
          </summary>
          <div className="mt-2 space-y-2">
            {brief.campaign_concepts.map((concept, idx) => (
              <div
                key={idx}
                className={`text-sm p-2 rounded border ${
                  brief.selected_campaign_index === idx
                    ? 'bg-blue-50 border-blue-200'
                    : 'bg-slate-50 border-slate-200'
                }`}
              >
                <span className="font-medium">{concept.conceptName}</span>
                {brief.selected_campaign_index === idx && (
                  <Badge variant="info" className="ml-2 text-xs">Selected</Badge>
                )}
              </div>
            ))}
          </div>
        </details>
      )}

      <div className="flex gap-2">
        {canContinue && (
          <Button size="sm" onClick={() => onContinue(brief)}>
            Continue
          </Button>
        )}
        <Button size="sm" variant="secondary" onClick={() => onView(brief)}>
          View Details
        </Button>
      </div>
    </div>
  );
}

export default function CampaignsTab({ briefs, loading, onContinueBrief, onViewBrief, onStartNew }) {
  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    );
  }

  if (!briefs || briefs.length === 0) {
    return (
      <div className="bg-slate-50 rounded-xl p-8 text-center">
        <div className="text-4xl mb-3">📝</div>
        <h3 className="font-semibold text-slate-800 mb-2">No Campaigns Yet</h3>
        <p className="text-slate-500 mb-4">
          Start your first creative workflow to generate campaign concepts.
        </p>
        <Button onClick={onStartNew}>Start New Campaign</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-slate-800">
          {briefs.length} Brief{briefs.length !== 1 ? 's' : ''}
        </h3>
        <Button onClick={onStartNew}>New Campaign</Button>
      </div>

      <div className="grid gap-4">
        {briefs.map(brief => (
          <BriefCard
            key={brief.id}
            brief={brief}
            onContinue={onContinueBrief}
            onView={onViewBrief}
          />
        ))}
      </div>
    </div>
  );
}
