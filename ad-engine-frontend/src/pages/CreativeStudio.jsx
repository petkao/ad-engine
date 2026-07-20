import { useEffect, useState } from 'react';
import { api } from '../api/client';
import {
  PageHeader, Button, Badge, Spinner,
  Modal, Field, Select
} from '../components/UI';

// Step indicators for the wizard
const STEPS = [
  { id: 'product', label: 'Select Product' },
  { id: 'campaign', label: 'Choose Campaign' },
  { id: 'script', label: 'Generate Script' },
  { id: 'storyboard', label: 'Review Storyboard' },
];

function StepIndicator({ currentStep, steps }) {
  const currentIndex = steps.findIndex(s => s.id === currentStep);
  return (
    <div className="flex items-center justify-center gap-2 mb-8">
      {steps.map((step, idx) => (
        <div key={step.id} className="flex items-center">
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
            idx === currentIndex ? 'bg-blue-600 text-white' :
            idx < currentIndex ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
          }`}>
            {idx < currentIndex ? '✓' : idx + 1}. {step.label}
          </div>
          {idx < steps.length - 1 && (
            <div className={`w-8 h-0.5 mx-1 ${idx < currentIndex ? 'bg-green-400' : 'bg-slate-200'}`} />
          )}
        </div>
      ))}
    </div>
  );
}

function ProductSelector({ products, onSelect, loading }) {
  if (loading) return <div className="text-center py-12"><Spinner /></div>;
  if (!products.length) return (
    <div className="text-center py-12 text-slate-500">
      No products found. Please create a product first.
    </div>
  );

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {products.map(product => (
        <div key={product.id}
          onClick={() => onSelect(product)}
          className="bg-white rounded-xl border border-slate-200 p-4 cursor-pointer hover:border-blue-400 hover:shadow-md transition-all">
          {product.image_url && (
            <img src={product.image_url} alt={product.title}
              className="w-full h-32 object-cover rounded-lg mb-3" />
          )}
          <h3 className="font-semibold text-slate-800 mb-1">{product.title}</h3>
          <p className="text-sm text-slate-500 line-clamp-2">{product.description}</p>
          <div className="flex gap-2 mt-2">
            <Badge variant="info">{product.category}</Badge>
            {product.price && <Badge variant="success">${product.price}</Badge>}
          </div>
        </div>
      ))}
    </div>
  );
}

function CampaignCard({ campaign, index, selected, onSelect }) {
  const toneColors = {
    inspirational: 'bg-purple-100 text-purple-700',
    humorous: 'bg-yellow-100 text-yellow-700',
    urgent: 'bg-red-100 text-red-700',
    educational: 'bg-blue-100 text-blue-700',
    emotional: 'bg-pink-100 text-pink-700',
    aspirational: 'bg-indigo-100 text-indigo-700',
  };

  return (
    <div
      onClick={() => onSelect(index)}
      className={`bg-white rounded-xl border-2 p-5 cursor-pointer transition-all ${
        selected ? 'border-blue-500 shadow-lg ring-2 ring-blue-200' : 'border-slate-200 hover:border-blue-300'
      }`}>
      <div className="flex items-start justify-between mb-3">
        <h3 className="font-bold text-lg text-slate-800">{campaign.conceptName}</h3>
        <span className={`text-xs px-2 py-1 rounded-full ${toneColors[campaign.tone] || 'bg-slate-100 text-slate-700'}`}>
          {campaign.tone}
        </span>
      </div>
      <p className="text-blue-600 font-medium italic mb-3">"{campaign.tagline}"</p>
      <div className="space-y-2 text-sm text-slate-600">
        <p><strong>Target:</strong> {campaign.targetAudience}</p>
        <p><strong>Hook:</strong> {campaign.emotionalHook}</p>
        <p><strong>Key Message:</strong> {campaign.keyMessage}</p>
        <p><strong>CTA:</strong> {campaign.callToAction}</p>
      </div>
      <div className="mt-4 pt-3 border-t border-slate-100">
        <p className="text-xs text-slate-500"><strong>Visual Direction:</strong> {campaign.visualDirection}</p>
      </div>
    </div>
  );
}

function ScriptViewer({ script, evaluation }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-lg">{script.title}</h3>
        <div className="flex gap-2">
          <Badge variant="info">{script.platform}</Badge>
          <Badge variant="default">{script.totalDuration}s</Badge>
        </div>
      </div>

      <div className="bg-blue-50 rounded-lg p-4 mb-4">
        <p className="text-sm font-medium text-blue-800">Hook: {script.hook}</p>
      </div>

      <div className="space-y-3">
        {script.segments.map((seg, idx) => (
          <div key={idx} className="bg-slate-50 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-bold text-slate-500">
                {seg.startTime}s - {seg.endTime}s
              </span>
            </div>
            <p className="text-sm text-slate-700 mb-2">{seg.voiceOver}</p>
            {seg.onScreenText && (
              <p className="text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded inline-block">
                On-screen: {seg.onScreenText}
              </p>
            )}
            <p className="text-xs text-slate-500 mt-2 italic">{seg.visualDescription}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 pt-4 border-t border-slate-200">
        <p className="text-sm font-semibold text-green-700">CTA: {script.closingCTA}</p>
      </div>

      {evaluation && (
        <div className="mt-4 pt-4 border-t border-slate-200">
          <h4 className="font-semibold text-sm mb-2">Quality Scores</h4>
          <div className="grid grid-cols-5 gap-2">
            {Object.entries(evaluation).filter(([k]) => k !== 'feedback' && k !== 'suggestions').map(([key, val]) => (
              <div key={key} className="text-center">
                <div className={`text-lg font-bold ${val >= 80 ? 'text-green-600' : val >= 60 ? 'text-yellow-600' : 'text-red-600'}`}>
                  {val}
                </div>
                <div className="text-xs text-slate-500 capitalize">{key}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StoryboardViewer({ storyboard, onApprove, onReject, approving }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-lg">{storyboard.storyboard_content.title}</h3>
        <div className="flex gap-2">
          <Badge variant="info">{storyboard.storyboard_content.aspectRatio}</Badge>
          <Badge variant="default">{storyboard.storyboard_content.totalDuration}s</Badge>
        </div>
      </div>

      <div className="space-y-4">
        {storyboard.storyboard_content.scenes.map((scene, idx) => (
          <div key={idx} className="bg-slate-50 rounded-lg p-4 border border-slate-200">
            <div className="flex items-center justify-between mb-3">
              <span className="font-semibold text-sm">Scene {scene.sceneNumber}</span>
              <span className="text-xs text-slate-500">{scene.startTime}s - {scene.endTime}s ({scene.duration}s)</span>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <h5 className="text-xs font-semibold text-slate-500 uppercase mb-1">Visual</h5>
                <p className="text-sm">{scene.visual.description}</p>
                <div className="flex gap-2 mt-2">
                  <span className="text-xs bg-slate-200 px-2 py-0.5 rounded">{scene.visual.shotType}</span>
                  {scene.visual.cameraMovement && (
                    <span className="text-xs bg-slate-200 px-2 py-0.5 rounded">{scene.visual.cameraMovement}</span>
                  )}
                </div>
              </div>

              <div>
                <h5 className="text-xs font-semibold text-slate-500 uppercase mb-1">Audio</h5>
                {scene.audio.voiceOver && (
                  <p className="text-sm text-slate-700 italic">"{scene.audio.voiceOver}"</p>
                )}
                {scene.audio.music && (
                  <p className="text-xs text-slate-500 mt-1">Music: {scene.audio.music}</p>
                )}
              </div>
            </div>

            {scene.textOverlays && scene.textOverlays.length > 0 && (
              <div className="mt-3 pt-3 border-t border-slate-200">
                <h5 className="text-xs font-semibold text-slate-500 uppercase mb-1">Text Overlays</h5>
                <div className="flex flex-wrap gap-2">
                  {scene.textOverlays.map((overlay, i) => (
                    <span key={i} className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">
                      {overlay.text} ({overlay.position})
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {storyboard.asset_requirements && storyboard.asset_requirements.length > 0 && (
        <div className="mt-6 pt-4 border-t border-slate-200">
          <h4 className="font-semibold text-sm mb-3">Asset Requirements</h4>
          <div className="grid grid-cols-2 gap-2">
            {storyboard.asset_requirements.map((asset, idx) => (
              <div key={idx} className={`text-xs p-2 rounded ${asset.required ? 'bg-red-50 text-red-700' : 'bg-slate-50 text-slate-600'}`}>
                <span className="font-medium">{asset.type}:</span> {asset.description}
                {asset.required && <span className="ml-1 text-red-500">*</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-6 pt-4 border-t border-slate-200 flex gap-3">
        <Button onClick={onApprove} disabled={approving}>
          {approving ? 'Approving...' : 'Approve Storyboard'}
        </Button>
        <Button variant="danger" onClick={onReject} disabled={approving}>
          Reject & Regenerate
        </Button>
      </div>
    </div>
  );
}

export default function CreativeStudio() {
  const [step, setStep] = useState('product');
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [generating, setGenerating] = useState(false);

  // Wizard state
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [brief, setBrief] = useState(null);
  const [selectedCampaignIndex, setSelectedCampaignIndex] = useState(null);
  const [script, setScript] = useState(null);
  const [storyboard, setStoryboard] = useState(null);

  // Script generation options
  const [platform, setPlatform] = useState('tiktok');
  const [duration, setDuration] = useState(15);
  const [aspectRatio, setAspectRatio] = useState('9:16');

  useEffect(() => {
    loadProducts();
  }, []);

  const loadProducts = async () => {
    try {
      setLoading(true);
      const data = await api.getProducts();
      setProducts(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleProductSelect = async (product) => {
    setSelectedProduct(product);
    setGenerating(true);
    setError('');

    try {
      const newBrief = await api.createCreativeBrief(product.id);
      setBrief(newBrief);
      setStep('campaign');
    } catch (err) {
      setError(`Failed to analyze product: ${err.message}`);
    } finally {
      setGenerating(false);
    }
  };

  const handleCampaignSelect = async (index) => {
    setSelectedCampaignIndex(index);
    setGenerating(true);
    setError('');

    try {
      await api.selectCampaign(brief.id, index);
      setBrief({ ...brief, selected_campaign_index: index });
      setStep('script');
    } catch (err) {
      setError(`Failed to select campaign: ${err.message}`);
    } finally {
      setGenerating(false);
    }
  };

  const handleGenerateScript = async () => {
    setGenerating(true);
    setError('');

    try {
      const newScript = await api.generateScript(brief.id, { platform, duration });
      setScript(newScript);
      setStep('storyboard');

      // Auto-generate storyboard
      const newStoryboard = await api.generateStoryboard(newScript.id, aspectRatio);
      setStoryboard(newStoryboard);
    } catch (err) {
      setError(`Failed to generate script: ${err.message}`);
    } finally {
      setGenerating(false);
    }
  };

  const handleApproveStoryboard = async () => {
    setGenerating(true);
    try {
      await api.updateStoryboardStatus(storyboard.id, 'approved');
      setStoryboard({ ...storyboard, status: 'approved' });
      setError('');
    } catch (err) {
      setError(`Failed to approve: ${err.message}`);
    } finally {
      setGenerating(false);
    }
  };

  const handleRejectStoryboard = async () => {
    setGenerating(true);
    try {
      await api.updateStoryboardStatus(storyboard.id, 'rejected');
      // Regenerate storyboard
      const newStoryboard = await api.generateStoryboard(script.id, aspectRatio);
      setStoryboard(newStoryboard);
      setError('');
    } catch (err) {
      setError(`Failed to regenerate: ${err.message}`);
    } finally {
      setGenerating(false);
    }
  };

  const resetWizard = () => {
    setStep('product');
    setSelectedProduct(null);
    setBrief(null);
    setSelectedCampaignIndex(null);
    setScript(null);
    setStoryboard(null);
    setError('');
  };

  return (
    <div>
      <PageHeader
        title="Creative Studio"
        subtitle="AI-powered video ad creation workflow"
        action={step !== 'product' && (
          <Button variant="secondary" onClick={resetWizard}>Start Over</Button>
        )}
      />

      <StepIndicator currentStep={step} steps={STEPS} />

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl mb-6">
          {error}
        </div>
      )}

      {generating && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-8 text-center shadow-2xl">
            <Spinner />
            <p className="mt-4 text-slate-600 font-medium">
              {step === 'product' && 'Analyzing product and generating campaigns...'}
              {step === 'campaign' && 'Selecting campaign...'}
              {step === 'script' && 'Generating script and storyboard...'}
              {step === 'storyboard' && 'Processing...'}
            </p>
            <p className="text-sm text-slate-400 mt-2">This may take 30-60 seconds</p>
          </div>
        </div>
      )}

      {/* Step 1: Select Product */}
      {step === 'product' && (
        <div>
          <h2 className="text-lg font-semibold mb-4">Select a product to create an ad for</h2>
          <ProductSelector products={products} onSelect={handleProductSelect} loading={loading} />
        </div>
      )}

      {/* Step 2: Choose Campaign */}
      {step === 'campaign' && brief && (
        <div>
          <div className="bg-slate-50 rounded-xl p-4 mb-6">
            <h3 className="font-semibold text-sm text-slate-600 mb-2">Product Analysis</h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><strong>Name:</strong> {brief.product_analysis.productName}</div>
              <div><strong>Category:</strong> {brief.product_analysis.category}</div>
              <div><strong>Price Point:</strong> {brief.product_analysis.pricePoint}</div>
              <div><strong>Primary Benefit:</strong> {brief.product_analysis.primaryBenefit}</div>
            </div>
          </div>

          <h2 className="text-lg font-semibold mb-4">Choose a campaign concept</h2>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {brief.campaign_concepts.map((campaign, idx) => (
              <CampaignCard
                key={idx}
                campaign={campaign}
                index={idx}
                selected={selectedCampaignIndex === idx}
                onSelect={handleCampaignSelect}
              />
            ))}
          </div>
        </div>
      )}

      {/* Step 3: Generate Script */}
      {step === 'script' && brief && (
        <div>
          <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
            <h2 className="text-lg font-semibold mb-4">Configure your script</h2>
            <div className="grid grid-cols-3 gap-4">
              <Field label="Platform">
                <Select value={platform} onChange={e => setPlatform(e.target.value)}>
                  <option value="tiktok">TikTok</option>
                  <option value="instagram">Instagram Reels</option>
                  <option value="youtube">YouTube Shorts</option>
                  <option value="generic">Generic</option>
                </Select>
              </Field>
              <Field label="Duration (seconds)">
                <Select value={duration} onChange={e => setDuration(Number(e.target.value))}>
                  <option value={15}>15 seconds</option>
                  <option value={30}>30 seconds</option>
                  <option value={60}>60 seconds</option>
                </Select>
              </Field>
              <Field label="Aspect Ratio">
                <Select value={aspectRatio} onChange={e => setAspectRatio(e.target.value)}>
                  <option value="9:16">9:16 (Vertical)</option>
                  <option value="16:9">16:9 (Horizontal)</option>
                  <option value="1:1">1:1 (Square)</option>
                  <option value="4:5">4:5 (Portrait)</option>
                </Select>
              </Field>
            </div>
            <div className="mt-4">
              <Button onClick={handleGenerateScript}>Generate Script & Storyboard</Button>
            </div>
          </div>

          <div className="bg-blue-50 rounded-xl p-4">
            <h3 className="font-semibold text-blue-800 mb-2">Selected Campaign: {brief.campaign_concepts[brief.selected_campaign_index]?.conceptName}</h3>
            <p className="text-blue-700 italic">"{brief.campaign_concepts[brief.selected_campaign_index]?.tagline}"</p>
          </div>
        </div>
      )}

      {/* Step 4: Review Storyboard */}
      {step === 'storyboard' && script && storyboard && (
        <div className="space-y-6">
          {storyboard.status === 'approved' ? (
            <div className="bg-green-50 border border-green-200 rounded-xl p-6 text-center">
              <div className="text-4xl mb-2">🎉</div>
              <h2 className="text-xl font-bold text-green-800 mb-2">Storyboard Approved!</h2>
              <p className="text-green-700 mb-4">Your creative is ready for production.</p>
              <Button onClick={resetWizard}>Create Another Ad</Button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div>
                  <h3 className="font-semibold mb-3">Generated Script</h3>
                  <ScriptViewer script={script.script_content} evaluation={script.evaluation_scores} />
                </div>
                <div>
                  <h3 className="font-semibold mb-3">Storyboard</h3>
                  <StoryboardViewer
                    storyboard={storyboard}
                    onApprove={handleApproveStoryboard}
                    onReject={handleRejectStoryboard}
                    approving={generating}
                  />
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
