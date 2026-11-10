/**
 * ProductStatusCard - Shows creative progress for a product
 */
import { Badge } from '../../components/UI';

export default function ProductStatusCard({ product, stats, loading }) {
  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-6 animate-pulse">
        <div className="h-5 bg-slate-200 rounded w-1/3 mb-4" />
        <div className="h-4 bg-slate-200 rounded w-1/2" />
      </div>
    );
  }

  const getProgressStage = () => {
    if (!stats) return { label: 'Not Started', color: 'bg-slate-100 text-slate-600' };
    if (stats.approvedStoryboardCount > 0) return { label: 'Complete', color: 'bg-green-100 text-green-700' };
    if (stats.storyboardCount > 0) return { label: 'Storyboard Generated', color: 'bg-blue-100 text-blue-700' };
    if (stats.scriptCount > 0) return { label: 'Script Generated', color: 'bg-blue-100 text-blue-700' };
    if (stats.hasSelectedCampaign) return { label: 'Campaign Selected', color: 'bg-yellow-100 text-yellow-700' };
    if (stats.hasProductAnalysis) return { label: 'Analyzed', color: 'bg-purple-100 text-purple-700' };
    if (stats.briefCount > 0) return { label: 'Brief Created', color: 'bg-slate-100 text-slate-600' };
    return { label: 'Not Started', color: 'bg-slate-100 text-slate-600' };
  };

  const progress = getProgressStage();

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6">
      <div className="flex items-start gap-4">
        {product.image_url && (
          <img
            src={product.image_url}
            alt={product.title}
            className="w-20 h-20 object-cover rounded-lg flex-shrink-0"
          />
        )}
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-lg text-slate-800 mb-1 truncate">
            {product.title}
          </h3>
          <p className="text-sm text-slate-500 mb-3 line-clamp-2">
            {product.description}
          </p>
          <div className="flex items-center gap-3">
            <span className={`text-xs px-2 py-1 rounded-full font-medium ${progress.color}`}>
              {progress.label}
            </span>
            <Badge variant="info">{product.category}</Badge>
            {product.price && <Badge variant="success">${product.price}</Badge>}
          </div>
        </div>
      </div>

      {stats && (
        <div className="mt-4 pt-4 border-t border-slate-100">
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-xl font-bold text-slate-800">{stats.briefCount}</div>
              <div className="text-xs text-slate-500">Briefs</div>
            </div>
            <div>
              <div className="text-xl font-bold text-slate-800">{stats.scriptCount}</div>
              <div className="text-xs text-slate-500">Scripts</div>
            </div>
            <div>
              <div className="text-xl font-bold text-slate-800">{stats.storyboardCount}</div>
              <div className="text-xs text-slate-500">Storyboards</div>
            </div>
          </div>
          {stats.latestActivityAt && (
            <p className="text-xs text-slate-400 text-center mt-3">
              Last activity: {new Date(stats.latestActivityAt).toLocaleDateString()}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
