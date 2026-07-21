/**
 * KnowledgeTab - Read-only product analysis display
 * Shows product_analysis JSONB data from briefs
 */
import { Spinner } from '../../components/UI';

function AnalysisSection({ title, children }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6">
      <h3 className="font-semibold text-slate-800 mb-4">{title}</h3>
      {children}
    </div>
  );
}

function DataRow({ label, value }) {
  if (!value) return null;
  return (
    <div className="py-2 border-b border-slate-100 last:border-b-0">
      <span className="text-sm text-slate-500">{label}</span>
      <p className="font-medium text-slate-800">{value}</p>
    </div>
  );
}

function ListSection({ items, emptyText = 'None' }) {
  if (!items || items.length === 0) {
    return <span className="text-slate-400 text-sm">{emptyText}</span>;
  }
  return (
    <ul className="list-disc list-inside space-y-1">
      {items.map((item, idx) => (
        <li key={idx} className="text-sm text-slate-700">{item}</li>
      ))}
    </ul>
  );
}

export default function KnowledgeTab({ briefs, loading }) {
  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    );
  }

  // Get the most recent brief with product analysis
  const briefWithAnalysis = briefs?.find(b => b.product_analysis);
  const analysis = briefWithAnalysis?.product_analysis;

  if (!analysis) {
    return (
      <div className="bg-slate-50 rounded-xl p-8 text-center">
        <div className="text-4xl mb-3">📋</div>
        <h3 className="font-semibold text-slate-800 mb-2">No Analysis Available</h3>
        <p className="text-slate-500">
          Start a new creative workflow to generate product analysis.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Last Updated */}
      <div className="text-sm text-slate-500">
        Analysis generated: {new Date(briefWithAnalysis.created_at).toLocaleString()}
      </div>

      {/* Core Product Info */}
      <AnalysisSection title="Product Overview">
        <div className="grid grid-cols-2 gap-4">
          <DataRow label="Product Name" value={analysis.productName} />
          <DataRow label="Category" value={analysis.category} />
          <DataRow label="Price Point" value={analysis.pricePoint} />
          <DataRow label="Primary Benefit" value={analysis.primaryBenefit} />
        </div>
      </AnalysisSection>

      {/* Audience & Positioning */}
      <AnalysisSection title="Target Audience">
        <DataRow label="Target Audience" value={analysis.targetAudience} />
        <DataRow label="Brand Voice" value={analysis.brandVoice} />
      </AnalysisSection>

      {/* Key Features */}
      {analysis.keyFeatures && (
        <AnalysisSection title="Key Features">
          <ListSection items={analysis.keyFeatures} />
        </AnalysisSection>
      )}

      {/* Pain Points */}
      {analysis.painPoints && (
        <AnalysisSection title="Customer Pain Points">
          <ListSection items={analysis.painPoints} />
        </AnalysisSection>
      )}

      {/* Differentiators */}
      {analysis.differentiators && (
        <AnalysisSection title="Differentiators">
          <ListSection items={analysis.differentiators} />
        </AnalysisSection>
      )}

      {/* Emotional Triggers */}
      {analysis.emotionalTriggers && (
        <AnalysisSection title="Emotional Triggers">
          <ListSection items={analysis.emotionalTriggers} />
        </AnalysisSection>
      )}

      {/* Competitive Landscape */}
      {analysis.competitiveLandscape && (
        <AnalysisSection title="Competitive Landscape">
          <p className="text-sm text-slate-700">{analysis.competitiveLandscape}</p>
        </AnalysisSection>
      )}

      {/* Raw JSON (collapsed by default for debugging) */}
      <details className="bg-slate-50 rounded-xl border border-slate-200">
        <summary className="p-4 cursor-pointer text-sm font-medium text-slate-600 hover:text-slate-800">
          View Raw Analysis JSON
        </summary>
        <pre className="p-4 pt-0 text-xs text-slate-600 overflow-auto max-h-96">
          {JSON.stringify(analysis, null, 2)}
        </pre>
      </details>
    </div>
  );
}
