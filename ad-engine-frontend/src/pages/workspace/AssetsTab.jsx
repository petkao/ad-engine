/**
 * AssetsTab - Scripts and Storyboards subsections
 * Displays all scripts and storyboards for a product with detail views
 */
import { useState } from 'react';
import { Badge, Button, Spinner } from '../../components/UI';
import { ScriptViewer, StoryboardViewer } from '../CreativeStudio';
import { api } from '../../api/client';

const SUBSECTIONS = [
  { id: 'scripts', label: 'Scripts' },
  { id: 'storyboards', label: 'Storyboards' },
];

function ScriptCard({ script, onView }) {
  const content = script.script_content;
  const campaign = script.campaign_concepts?.[script.selected_campaign_index];

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h4 className="font-semibold text-slate-800">{content?.title || 'Untitled Script'}</h4>
          <span className="text-xs text-slate-400">
            {new Date(script.created_at).toLocaleString()}
          </span>
        </div>
        <div className="flex gap-2">
          <Badge variant="info">{script.platform}</Badge>
          <Badge variant="default">{script.duration_seconds}s</Badge>
        </div>
      </div>

      {campaign && (
        <p className="text-sm text-blue-600 italic mb-3">
          Campaign: {campaign.conceptName}
        </p>
      )}

      {content?.hook && (
        <div className="bg-blue-50 rounded-lg p-3 mb-3">
          <p className="text-sm text-blue-800">
            <span className="font-medium">Hook:</span> {content.hook}
          </p>
        </div>
      )}

      {script.evaluation_scores && (
        <div className="flex gap-2 mb-3">
          {Object.entries(script.evaluation_scores)
            .filter(([k]) => k !== 'feedback' && k !== 'suggestions')
            .slice(0, 3)
            .map(([key, val]) => (
              <span
                key={key}
                className={`text-xs px-2 py-1 rounded ${
                  val >= 80 ? 'bg-green-100 text-green-700' :
                  val >= 60 ? 'bg-yellow-100 text-yellow-700' :
                  'bg-red-100 text-red-700'
                }`}
              >
                {key}: {val}
              </span>
            ))}
        </div>
      )}

      <Button size="sm" variant="secondary" onClick={() => onView(script)}>
        View Full Script
      </Button>
    </div>
  );
}

function StoryboardCard({ storyboard, onView }) {
  const content = storyboard.storyboard_content;
  const sceneCount = content?.scenes?.length || 0;

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h4 className="font-semibold text-slate-800">{content?.title || 'Untitled Storyboard'}</h4>
          <span className="text-xs text-slate-400">
            {new Date(storyboard.created_at).toLocaleString()}
          </span>
        </div>
        <div className="flex gap-2">
          <Badge variant="info">{content?.aspectRatio || '9:16'}</Badge>
          <Badge variant="default">{content?.totalDuration || storyboard.duration_seconds}s</Badge>
          {storyboard.status === 'approved' && (
            <Badge variant="success">Approved</Badge>
          )}
        </div>
      </div>

      <p className="text-sm text-slate-500 mb-3">
        {sceneCount} scene{sceneCount !== 1 ? 's' : ''} • Platform: {storyboard.platform}
      </p>

      {/* Scene previews */}
      {content?.scenes && (
        <div className="flex gap-2 overflow-x-auto pb-2 mb-3">
          {content.scenes.slice(0, 4).map((scene, idx) => (
            <div
              key={idx}
              className="flex-shrink-0 w-24 h-16 bg-slate-100 rounded border border-slate-200 flex items-center justify-center text-xs text-slate-500"
            >
              Scene {scene.sceneNumber}
            </div>
          ))}
          {content.scenes.length > 4 && (
            <div className="flex-shrink-0 w-24 h-16 bg-slate-50 rounded border border-dashed border-slate-200 flex items-center justify-center text-xs text-slate-400">
              +{content.scenes.length - 4} more
            </div>
          )}
        </div>
      )}

      <Button size="sm" variant="secondary" onClick={() => onView(storyboard)}>
        View Full Storyboard
      </Button>
    </div>
  );
}

/**
 * Script Detail Modal - displays full script using ScriptViewer
 */
function ScriptDetailModal({ script, onClose }) {
  if (!script) return null;

  const content = script.script_content;
  const campaign = script.campaign_concepts?.[script.selected_campaign_index];

  return (
    <div className="fixed inset-0 bg-slate-900/50 flex items-start justify-center z-50 overflow-y-auto py-8">
      <div className="bg-white rounded-xl shadow-2xl max-w-3xl w-full mx-4 my-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-200">
          <div>
            <h2 className="font-semibold text-lg text-slate-800">Script Details</h2>
            <p className="text-sm text-slate-500">
              Created {new Date(script.created_at).toLocaleString()}
            </p>
          </div>
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>

        {/* Metadata */}
        <div className="p-4 bg-slate-50 border-b border-slate-200">
          <div className="flex flex-wrap gap-4 text-sm">
            <div>
              <span className="text-slate-500">Platform:</span>
              <span className="ml-1 font-medium">{script.platform}</span>
            </div>
            <div>
              <span className="text-slate-500">Duration:</span>
              <span className="ml-1 font-medium">{script.duration_seconds}s</span>
            </div>
            <div>
              <span className="text-slate-500">Status:</span>
              <span className="ml-1 font-medium">{script.status || 'generated'}</span>
            </div>
            {campaign && (
              <div>
                <span className="text-slate-500">Campaign:</span>
                <span className="ml-1 font-medium text-blue-600">{campaign.conceptName}</span>
              </div>
            )}
          </div>
        </div>

        {/* Script Content */}
        <div className="p-4">
          {content ? (
            <ScriptViewer script={content} evaluation={script.evaluation_scores} />
          ) : (
            <div className="text-center py-8 text-slate-500">
              Script content not available
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Storyboard Detail Modal - displays full storyboard with approve/reject
 */
function StoryboardDetailModal({ storyboard, onClose, onStatusChange }) {
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState('');

  if (!storyboard) return null;

  const handleApprove = async () => {
    setUpdating(true);
    setError('');
    try {
      await api.updateStoryboardStatus(storyboard.id, 'approved');
      onStatusChange(storyboard.id, 'approved');
    } catch (err) {
      setError(`Failed to approve: ${err.message}`);
    } finally {
      setUpdating(false);
    }
  };

  const handleReject = async () => {
    setUpdating(true);
    setError('');
    try {
      await api.updateStoryboardStatus(storyboard.id, 'rejected');
      onStatusChange(storyboard.id, 'rejected');
    } catch (err) {
      setError(`Failed to reject: ${err.message}`);
    } finally {
      setUpdating(false);
    }
  };

  const content = storyboard.storyboard_content;

  return (
    <div className="fixed inset-0 bg-slate-900/50 flex items-start justify-center z-50 overflow-y-auto py-8">
      <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full mx-4 my-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-200">
          <div>
            <h2 className="font-semibold text-lg text-slate-800">Storyboard Details</h2>
            <p className="text-sm text-slate-500">
              Created {new Date(storyboard.created_at).toLocaleString()}
            </p>
          </div>
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>

        {/* Metadata */}
        <div className="p-4 bg-slate-50 border-b border-slate-200">
          <div className="flex flex-wrap gap-4 text-sm">
            <div>
              <span className="text-slate-500">Platform:</span>
              <span className="ml-1 font-medium">{storyboard.platform}</span>
            </div>
            <div>
              <span className="text-slate-500">Duration:</span>
              <span className="ml-1 font-medium">{storyboard.duration_seconds}s</span>
            </div>
            <div>
              <span className="text-slate-500">Status:</span>
              <Badge variant={storyboard.status === 'approved' ? 'success' : 'default'}>
                {storyboard.status || 'generated'}
              </Badge>
            </div>
            {storyboard.render_status && (
              <div>
                <span className="text-slate-500">Render:</span>
                <span className="ml-1 font-medium">{storyboard.render_status}</span>
              </div>
            )}
          </div>

          {/* Asset Requirements Summary */}
          {storyboard.asset_requirements && storyboard.asset_requirements.length > 0 && (
            <div className="mt-3 pt-3 border-t border-slate-200">
              <span className="text-sm text-slate-500">Asset Requirements:</span>
              <span className="ml-1 text-sm font-medium">
                {storyboard.asset_requirements.length} items
              </span>
            </div>
          )}

          {/* Render Spec Summary */}
          {storyboard.render_spec && (
            <div className="mt-2">
              <span className="text-sm text-slate-500">Render Spec:</span>
              <span className="ml-1 text-sm font-medium">
                {storyboard.render_spec.resolution || 'Standard'}
              </span>
            </div>
          )}
        </div>

        {/* Error Display */}
        {error && (
          <div className="mx-4 mt-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
            {error}
          </div>
        )}

        {/* Storyboard Content */}
        <div className="p-4">
          {content ? (
            <StoryboardViewer
              storyboard={storyboard}
              onApprove={handleApprove}
              onReject={handleReject}
              approving={updating}
            />
          ) : (
            <div className="text-center py-8 text-slate-500">
              Storyboard content not available
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AssetsTab({
  scripts,
  storyboards,
  loading,
  onStoryboardStatusChange,
}) {
  const [activeSubsection, setActiveSubsection] = useState('scripts');
  const [selectedScript, setSelectedScript] = useState(null);
  const [selectedStoryboard, setSelectedStoryboard] = useState(null);

  // Handle storyboard status change from detail modal
  const handleStoryboardStatusChange = (storyboardId, newStatus) => {
    // Update local state
    setSelectedStoryboard(prev =>
      prev?.id === storyboardId ? { ...prev, status: newStatus } : prev
    );
    // Notify parent to refresh data if callback provided
    if (onStoryboardStatusChange) {
      onStoryboardStatusChange(storyboardId, newStatus);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    );
  }

  const hasScripts = scripts && scripts.length > 0;
  const hasStoryboards = storyboards && storyboards.length > 0;

  if (!hasScripts && !hasStoryboards) {
    return (
      <div className="bg-slate-50 rounded-xl p-8 text-center">
        <div className="text-4xl mb-3">🎨</div>
        <h3 className="font-semibold text-slate-800 mb-2">No Assets Yet</h3>
        <p className="text-slate-500">
          Complete a creative workflow to generate scripts and storyboards.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Script Detail Modal */}
      {selectedScript && (
        <ScriptDetailModal
          script={selectedScript}
          onClose={() => setSelectedScript(null)}
        />
      )}

      {/* Storyboard Detail Modal */}
      {selectedStoryboard && (
        <StoryboardDetailModal
          storyboard={selectedStoryboard}
          onClose={() => setSelectedStoryboard(null)}
          onStatusChange={handleStoryboardStatusChange}
        />
      )}

      {/* Subsection Tabs */}
      <div className="flex gap-2">
        {SUBSECTIONS.map(sub => (
          <button
            key={sub.id}
            onClick={() => setActiveSubsection(sub.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeSubsection === sub.id
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {sub.label}
            <span className="ml-2 text-xs opacity-75">
              ({sub.id === 'scripts' ? scripts?.length || 0 : storyboards?.length || 0})
            </span>
          </button>
        ))}
      </div>

      {/* Scripts Subsection */}
      {activeSubsection === 'scripts' && (
        <div className="space-y-4">
          {hasScripts ? (
            scripts.map(script => (
              <ScriptCard
                key={script.id}
                script={script}
                onView={setSelectedScript}
              />
            ))
          ) : (
            <div className="bg-slate-50 rounded-xl p-6 text-center">
              <p className="text-slate-500">No scripts generated yet.</p>
            </div>
          )}
        </div>
      )}

      {/* Storyboards Subsection */}
      {activeSubsection === 'storyboards' && (
        <div className="space-y-4">
          {hasStoryboards ? (
            storyboards.map(storyboard => (
              <StoryboardCard
                key={storyboard.id}
                storyboard={storyboard}
                onView={setSelectedStoryboard}
              />
            ))
          ) : (
            <div className="bg-slate-50 rounded-xl p-6 text-center">
              <p className="text-slate-500">No storyboards generated yet.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
