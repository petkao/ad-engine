/**
 * OverviewTab - Product status and latest brief overview
 */
import { Button } from '../../components/UI';
import ProductStatusCard from './ProductStatusCard';

export default function OverviewTab({
  product,
  stats,
  briefs,
  loading,
  onStartNewBrief,
  onContinueBrief,
}) {
  const latestBrief = briefs?.[0];

  // Determine if latest brief can be continued
  const canContinue = latestBrief && (
    !latestBrief.selected_campaign_index && latestBrief.product_analysis
  );

  return (
    <div className="space-y-6">
      {/* Product Status */}
      <ProductStatusCard product={product} stats={stats} loading={loading} />

      {/* Actions */}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h3 className="font-semibold text-slate-800 mb-4">Quick Actions</h3>
        <div className="flex gap-3">
          <Button onClick={onStartNewBrief}>
            Start New Creative
          </Button>
          {canContinue && (
            <Button variant="secondary" onClick={() => onContinueBrief(latestBrief)}>
              Continue Latest Brief
            </Button>
          )}
        </div>
      </div>

      {/* Latest Brief Summary */}
      {latestBrief && latestBrief.product_analysis && (
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-slate-800">Latest Analysis</h3>
            <span className="text-xs text-slate-400">
              {new Date(latestBrief.created_at).toLocaleString()}
            </span>
          </div>

          <div className="bg-slate-50 rounded-lg p-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-slate-500">Name:</span>
                <span className="ml-2 font-medium">{latestBrief.product_analysis.productName}</span>
              </div>
              <div>
                <span className="text-slate-500">Category:</span>
                <span className="ml-2 font-medium">{latestBrief.product_analysis.category}</span>
              </div>
              <div>
                <span className="text-slate-500">Price Point:</span>
                <span className="ml-2 font-medium">{latestBrief.product_analysis.pricePoint}</span>
              </div>
              <div>
                <span className="text-slate-500">Primary Benefit:</span>
                <span className="ml-2 font-medium">{latestBrief.product_analysis.primaryBenefit}</span>
              </div>
            </div>
          </div>

          {latestBrief.selected_campaign_index !== null && latestBrief.campaign_concepts && (
            <div className="mt-4 pt-4 border-t border-slate-100">
              <h4 className="text-sm font-medium text-slate-600 mb-2">Selected Campaign</h4>
              <div className="bg-blue-50 rounded-lg p-3">
                <p className="font-semibold text-blue-800">
                  {latestBrief.campaign_concepts[latestBrief.selected_campaign_index]?.conceptName}
                </p>
                <p className="text-sm text-blue-600 italic mt-1">
                  "{latestBrief.campaign_concepts[latestBrief.selected_campaign_index]?.tagline}"
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Empty State */}
      {!loading && (!briefs || briefs.length === 0) && (
        <div className="bg-slate-50 rounded-xl p-8 text-center">
          <div className="text-4xl mb-3">🎬</div>
          <h3 className="font-semibold text-slate-800 mb-2">No creatives yet</h3>
          <p className="text-slate-500 mb-4">
            Start creating AI-powered video ads for this product.
          </p>
          <Button onClick={onStartNewBrief}>Create First Ad</Button>
        </div>
      )}
    </div>
  );
}
