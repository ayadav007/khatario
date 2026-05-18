// Product Data Service - Provides product information to AI sales agent
// Includes searching, fetching, and formatting product data for AI context

import { queryRows } from '@/lib/db';

export interface ProductInfo {
  id: string;
  name: string;
  code?: string;
  description?: string;
  sellingPrice: number;
  mrp?: number;
  unit: string;
  currentStock: number;
  itemType: 'product' | 'service';
  imageUrl?: string;
  variants?: Array<{
    id: string;
    variantName: string;
    sellingPrice: number;
    currentStock: number;
    attributes?: any;
  }>;
}

export class ProductDataService {
  /**
   * Search products by name, code, or description
   */
  async searchProducts(
    businessId: string,
    query: string,
    limit: number = 10,
    branchId?: string | null
  ): Promise<ProductInfo[]> {
    try {
      const stockExpr = branchId
        ? `COALESCE((SELECT bis.quantity FROM branch_item_stock bis
            WHERE bis.business_id = i.business_id AND bis.item_id = i.id AND bis.branch_id = $5::uuid), i.current_stock, 0)`
        : 'i.current_stock';
      const variantStockExpr = branchId
        ? `COALESCE((SELECT biv.quantity FROM branch_item_variant_stock biv
            WHERE biv.business_id = i.business_id AND biv.item_variant_id = iv.id AND biv.branch_id = $5::uuid), iv.current_stock, 0)`
        : 'iv.current_stock';

      const params = branchId
        ? [businessId, `%${query}%`, `${query}%`, limit, branchId]
        : [businessId, `%${query}%`, `${query}%`, limit];

      const items = await queryRows<any>(
        `SELECT 
          i.id, 
          i.name, 
          i.code,
          i.description,
          i.selling_price,
          i.mrp,
          i.unit,
          ${stockExpr} as current_stock,
          i.item_type,
          i.image_url,
          i.has_variants,
          COALESCE(
            json_agg(
              json_build_object(
                'id', iv.id,
                'variantName', iv.variant_name,
                'sellingPrice', iv.selling_price,
                'currentStock', ${variantStockExpr},
                'attributes', iv.attributes
              )
            ) FILTER (WHERE iv.id IS NOT NULL),
            '[]'::json
          ) as variants
         FROM items i
         LEFT JOIN item_variants iv ON iv.item_id = i.id
         WHERE i.business_id = $1 
         AND (
           i.name ILIKE $2 OR 
           i.code ILIKE $2 OR
           i.description ILIKE $2
         )
         AND (i.is_active IS NULL OR i.is_active = true)
         GROUP BY i.id
         ORDER BY 
           CASE WHEN i.name ILIKE $3 THEN 1 ELSE 2 END,
           i.name ASC
         LIMIT $4`,
        params
      );

      return items.map((item: any) => ({
        id: item.id,
        name: item.name,
        code: item.code,
        description: item.description,
        sellingPrice: parseFloat(item.selling_price) || 0,
        mrp: item.mrp ? parseFloat(item.mrp) : undefined,
        unit: item.unit || 'PCS',
        currentStock: parseFloat(item.current_stock) || 0,
        itemType: item.item_type || 'product',
        imageUrl: item.image_url,
        variants: item.variants && Array.isArray(item.variants) ? item.variants : [],
      }));
    } catch (error) {
      console.error('Error searching products:', error);
      return [];
    }
  }

  /**
   * Get product by ID
   */
  async getProduct(businessId: string, productId: string, branchId?: string | null): Promise<ProductInfo | null> {
    try {
      const stockExpr = branchId
        ? `COALESCE((SELECT bis.quantity FROM branch_item_stock bis
            WHERE bis.business_id = i.business_id AND bis.item_id = i.id AND bis.branch_id = $3::uuid), i.current_stock, 0)`
        : 'i.current_stock';
      const variantStockExpr = branchId
        ? `COALESCE((SELECT biv.quantity FROM branch_item_variant_stock biv
            WHERE biv.business_id = i.business_id AND biv.item_variant_id = iv.id AND biv.branch_id = $3::uuid), iv.current_stock, 0)`
        : 'iv.current_stock';
      const params = branchId ? [businessId, productId, branchId] : [businessId, productId];

      const items = await queryRows<any>(
        `SELECT 
          i.id, 
          i.name, 
          i.code,
          i.description,
          i.selling_price,
          i.mrp,
          i.unit,
          ${stockExpr} as current_stock,
          i.item_type,
          i.image_url,
          i.has_variants,
          COALESCE(
            json_agg(
              json_build_object(
                'id', iv.id,
                'variantName', iv.variant_name,
                'sellingPrice', iv.selling_price,
                'currentStock', ${variantStockExpr},
                'attributes', iv.attributes
              )
            ) FILTER (WHERE iv.id IS NOT NULL),
            '[]'::json
          ) as variants
         FROM items i
         LEFT JOIN item_variants iv ON iv.item_id = i.id
         WHERE i.business_id = $1 AND i.id = $2
         GROUP BY i.id`,
        params
      );

      if (items.length === 0) return null;

      const item = items[0];
      return {
        id: item.id,
        name: item.name,
        code: item.code,
        description: item.description,
        sellingPrice: parseFloat(item.selling_price) || 0,
        mrp: item.mrp ? parseFloat(item.mrp) : undefined,
        unit: item.unit || 'PCS',
        currentStock: parseFloat(item.current_stock) || 0,
        itemType: item.item_type || 'product',
        imageUrl: item.image_url,
        variants: item.variants && Array.isArray(item.variants) ? item.variants : [],
      };
    } catch (error) {
      console.error('Error getting product:', error);
      return null;
    }
  }

  /**
   * Get top products (for initial context - limit to top products)
   */
  async getTopProducts(businessId: string, limit: number = 20, branchId?: string | null): Promise<ProductInfo[]> {
    try {
      const stockExpr = branchId
        ? `COALESCE((SELECT bis.quantity FROM branch_item_stock bis
            WHERE bis.business_id = i.business_id AND bis.item_id = i.id AND bis.branch_id = $3::uuid), i.current_stock, 0)`
        : 'i.current_stock';
      const params = branchId ? [businessId, limit, branchId] : [businessId, limit];

      const items = await queryRows<any>(
        `SELECT 
          i.id, 
          i.name, 
          i.code,
          i.description,
          i.selling_price,
          i.mrp,
          i.unit,
          ${stockExpr} as current_stock,
          i.item_type,
          i.image_url
         FROM items i
         WHERE i.business_id = $1 
         AND (i.is_active IS NULL OR i.is_active = true)
         ORDER BY i.name ASC
         LIMIT $2`,
        params
      );

      return items.map((item: any) => ({
        id: item.id,
        name: item.name,
        code: item.code,
        description: item.description,
        sellingPrice: parseFloat(item.selling_price) || 0,
        mrp: item.mrp ? parseFloat(item.mrp) : undefined,
        unit: item.unit || 'PCS',
        currentStock: parseFloat(item.current_stock) || 0,
        itemType: item.item_type || 'product',
        imageUrl: item.image_url,
        variants: [],
      }));
    } catch (error) {
      console.error('Error getting top products:', error);
      return [];
    }
  }

  /**
   * Format product information for AI context
   */
  formatProductsForAI(products: ProductInfo[]): string {
    if (products.length === 0) return 'No products found.';

    return products.map((p, idx) => {
      let info = `${idx + 1}. ${p.name}`;
      if (p.code) info += ` (Code: ${p.code})`;
      info += `\n   Price: ₹${p.sellingPrice.toLocaleString('en-IN')}`;
      if (p.mrp && p.mrp > p.sellingPrice) {
        info += ` (MRP: ₹${p.mrp.toLocaleString('en-IN')})`;
      }
      info += ` per ${p.unit}`;
      if (p.itemType === 'product') {
        info += `\n   Stock: ${p.currentStock > 0 ? `${p.currentStock} ${p.unit} available` : 'Out of stock'}`;
      }
      if (p.description) {
        info += `\n   Description: ${p.description}`;
      }
      if (p.variants && p.variants.length > 0) {
        info += `\n   Variants: ${p.variants.map(v => `${v.variantName} (₹${v.sellingPrice})`).join(', ')}`;
      }
      return info;
    }).join('\n\n');
  }
}
