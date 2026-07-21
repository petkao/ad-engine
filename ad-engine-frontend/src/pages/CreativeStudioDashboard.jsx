/**
 * CreativeStudioDashboard - Landing page showing seller's products
 * Allows opening product workspaces or starting new creative workflows
 */
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { PageHeader, Button, Badge, Spinner } from '../components/UI';

function ProductCard({ product, onOpenWorkspace, onQuickCreate }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden hover:shadow-md transition-shadow">
      {product.image_url && (
        <img
          src={product.image_url}
          alt={product.title}
          className="w-full h-36 object-cover"
        />
      )}
      <div className="p-4">
        <h3 className="font-semibold text-slate-800 mb-1 truncate">{product.title}</h3>
        <p className="text-sm text-slate-500 line-clamp-2 mb-3">{product.description}</p>
        <div className="flex gap-2 mb-4">
          <Badge variant="info">{product.category}</Badge>
          {product.price && <Badge variant="success">${product.price}</Badge>}
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => onOpenWorkspace(product)}>
            Open Workspace
          </Button>
          <Button size="sm" variant="secondary" onClick={() => onQuickCreate(product)}>
            Quick Create
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function CreativeStudioDashboard({ onOpenWorkspace, onStartWizard }) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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

  if (loading) {
    return (
      <div>
        <PageHeader
          title="Creative Studio"
          subtitle="AI-powered video ad creation"
        />
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Creative Studio"
        subtitle="AI-powered video ad creation"
      />

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl mb-6">
          {error}
          <button onClick={loadProducts} className="ml-2 underline hover:no-underline">
            Retry
          </button>
        </div>
      )}

      {products.length === 0 ? (
        <div className="bg-slate-50 rounded-xl p-8 text-center">
          <div className="text-4xl mb-3">📦</div>
          <h3 className="font-semibold text-slate-800 mb-2">No Products Yet</h3>
          <p className="text-slate-500 mb-4">
            Create a product first to start generating creative ads.
          </p>
        </div>
      ) : (
        <>
          <div className="mb-6">
            <p className="text-slate-600">
              Select a product to open its workspace or start a quick creative workflow.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {products.map(product => (
              <ProductCard
                key={product.id}
                product={product}
                onOpenWorkspace={onOpenWorkspace}
                onQuickCreate={onStartWizard}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
