#!/usr/bin/env node

/**
 * Report Verification Audit Script
 * 
 * This script:
 * 1. Scans all report API routes
 * 2. Extracts assertReportAccess calls and their categories
 * 3. Maps API routes to sidebar routes
 * 4. Checks legacyRouteFeatureMap completeness
 * 5. Generates comprehensive audit report
 */

const fs = require('fs');
const path = require('path');

const REPORTS_API_DIR = path.join(process.cwd(), 'app', 'api', 'reports');
const SIDEBAR_FILE = path.join(process.cwd(), 'components', 'layout', 'Sidebar.tsx');
const OUTPUT_FILE = path.join(process.cwd(), 'docs', 'REPORTS_AUDIT_REPORT.md');

// Expected categories
const CATEGORIES = {
  'basic': 'reports_basic',
  'gst': 'reports_gst',
  'advanced': 'reports_advanced'
};

// Plan feature mapping
const PLAN_FEATURES = {
  'reports_basic': { free: false, professional: true, business: true, enterprise: true },
  'reports_gst': { free: false, professional: false, business: true, enterprise: true },
  'reports_advanced': { free: false, professional: false, business: true, enterprise: true }
};

/**
 * Convert API route path to sidebar route path
 */
function apiRouteToSidebarRoute(apiPath) {
  // Remove /api/reports prefix
  let route = apiPath.replace(/^app[\\/]api[\\/]reports[\\/]/, '');
  
  // Remove /route.ts suffix
  route = route.replace(/[\\/]route\.ts$/, '');
  
  // Handle special cases
  route = route.replace(/\[filingId\]/, '');
  route = route.replace(/\[id\]/, '');
  
  // Convert to forward slashes
  route = route.replace(/\\/g, '/');
  
  // Add /reports prefix
  return '/reports/' + route;
}

/**
 * Extract report category from API route file
 */
function extractReportCategory(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    
    // Look for assertReportAccess calls
    const assertReportMatch = content.match(/assertReportAccess\s*\(\s*[^,]+,\s*['"](basic|gst|advanced)['"]/);
    if (assertReportMatch) {
      return assertReportMatch[1];
    }
    
    // Look for requireFeature or hasFeature with reports_ prefix
    const featureMatch = content.match(/(assertFeatureAccess|requireFeature|hasFeature)\s*\(\s*[^,]+,\s*['"](reports_(?:basic|gst|advanced))['"]/);
    if (featureMatch) {
      const feature = featureMatch[2];
      if (feature === 'reports_basic') return 'basic';
      if (feature === 'reports_gst') return 'gst';
      if (feature === 'reports_advanced') return 'advanced';
    }
    
    return null;
  } catch (error) {
    console.error(`Error reading ${filePath}:`, error.message);
    return null;
  }
}

/**
 * Get all report API routes recursively
 */
function getAllReportRoutes(dir, basePath = '') {
  const routes = [];
  
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.join(basePath, entry.name);
      
      if (entry.isDirectory()) {
        routes.push(...getAllReportRoutes(fullPath, relativePath));
      } else if (entry.name === 'route.ts') {
        routes.push({
          filePath: fullPath,
          relativePath: relativePath,
          apiRoute: path.join('app', 'api', 'reports', relativePath)
        });
      }
    }
  } catch (error) {
    console.error(`Error reading directory ${dir}:`, error.message);
  }
  
  return routes;
}

/**
 * Extract sidebar routes from Sidebar.tsx
 */
function extractSidebarRoutes() {
  try {
    const content = fs.readFileSync(SIDEBAR_FILE, 'utf8');
    const routes = [];
    
    // Extract href patterns
    const hrefMatches = content.matchAll(/href:\s*['"]([^'"]+)['"]/g);
    for (const match of hrefMatches) {
      const href = match[1];
      if (href.startsWith('/reports')) {
        routes.push(href);
      }
    }
    
    // Extract legacyRouteFeatureMap
    const mapMatch = content.match(/legacyRouteFeatureMap:\s*Record<string,\s*string>\s*=\s*\{([^}]+)\}/s);
    const legacyMap = {};
    if (mapMatch) {
      const mapContent = mapMatch[1];
      const mapEntries = mapContent.matchAll(/['"]([^'"]+)['"]:\s*['"]([^'"]+)['"]/g);
      for (const entry of mapEntries) {
        legacyMap[entry[1]] = entry[2];
      }
    }
    
    return { routes: [...new Set(routes)], legacyMap };
  } catch (error) {
    console.error(`Error reading Sidebar.tsx:`, error.message);
    return { routes: [], legacyMap: {} };
  }
}

/**
 * Main audit function
 */
function runAudit() {
  console.log('🔍 Starting Report Verification Audit...\n');
  
  // Get all report API routes
  console.log('📁 Scanning report API routes...');
  const apiRoutes = getAllReportRoutes(REPORTS_API_DIR);
  console.log(`   Found ${apiRoutes.length} report API routes\n`);
  
  // Extract categories from each route
  console.log('🔎 Extracting report categories...');
  const reportData = [];
  for (const route of apiRoutes) {
    const category = extractReportCategory(route.filePath);
    const sidebarRoute = apiRouteToSidebarRoute(route.apiRoute);
    
    reportData.push({
      apiRoute: route.apiRoute,
      sidebarRoute: sidebarRoute,
      category: category,
      featureKey: category ? CATEGORIES[category] : null,
      hasEnforcement: category !== null
    });
  }
  
  // Get sidebar routes
  console.log('📋 Extracting sidebar routes...');
  const { routes: sidebarRoutes, legacyMap } = extractSidebarRoutes();
  console.log(`   Found ${sidebarRoutes.length} sidebar report routes`);
  console.log(`   Found ${Object.keys(legacyMap).length} legacy route mappings\n`);
  
  // Analyze results
  console.log('📊 Analyzing results...\n');
  
  const analysis = {
    totalApiRoutes: reportData.length,
    routesWithEnforcement: reportData.filter(r => r.hasEnforcement).length,
    routesWithoutEnforcement: reportData.filter(r => !r.hasEnforcement).length,
    categoryBreakdown: {
      basic: reportData.filter(r => r.category === 'basic').length,
      gst: reportData.filter(r => r.category === 'gst').length,
      advanced: reportData.filter(r => r.category === 'advanced').length,
      unknown: reportData.filter(r => !r.category).length
    },
    sidebarRoutes: sidebarRoutes.length,
    missingInLegacyMap: [],
    missingInSidebar: [],
    categoryMismatches: []
  };
  
  // Check for routes missing in legacy map
  for (const report of reportData) {
    if (report.sidebarRoute && !legacyMap[report.sidebarRoute] && report.category) {
      analysis.missingInLegacyMap.push({
        route: report.sidebarRoute,
        category: report.category,
        featureKey: report.featureKey
      });
    }
  }
  
  // Check for sidebar routes without API routes
  for (const sidebarRoute of sidebarRoutes) {
    const hasApiRoute = reportData.some(r => r.sidebarRoute === sidebarRoute);
    if (!hasApiRoute && sidebarRoute !== '/reports') {
      analysis.missingInSidebar.push(sidebarRoute);
    }
  }
  
  // Generate report
  generateReport(reportData, sidebarRoutes, legacyMap, analysis);
  
  console.log('✅ Audit complete! Report generated at:', OUTPUT_FILE);
}

/**
 * Generate markdown report
 */
function generateReport(reportData, sidebarRoutes, legacyMap, analysis) {
  let markdown = `# Report Verification Audit Report\n\n`;
  markdown += `**Generated:** ${new Date().toISOString()}\n\n`;
  markdown += `---\n\n`;
  
  // Executive Summary
  markdown += `## 📊 Executive Summary\n\n`;
  markdown += `| Metric | Count |\n`;
  markdown += `|--------|-------|\n`;
  markdown += `| Total API Routes | ${analysis.totalApiRoutes} |\n`;
  markdown += `| Routes with Enforcement | ${analysis.routesWithEnforcement} |\n`;
  markdown += `| Routes without Enforcement | ${analysis.routesWithoutEnforcement} |\n`;
  markdown += `| Sidebar Routes | ${analysis.sidebarRoutes} |\n`;
  markdown += `| Legacy Map Entries | ${Object.keys(legacyMap).length} |\n\n`;
  
  markdown += `### Category Breakdown\n\n`;
  markdown += `| Category | Count |\n`;
  markdown += `|----------|-------|\n`;
  markdown += `| Basic Reports | ${analysis.categoryBreakdown.basic} |\n`;
  markdown += `| GST Reports | ${analysis.categoryBreakdown.gst} |\n`;
  markdown += `| Advanced Reports | ${analysis.categoryBreakdown.advanced} |\n`;
  markdown += `| Unknown/No Enforcement | ${analysis.categoryBreakdown.unknown} |\n\n`;
  
  // Issues
  markdown += `## ⚠️ Issues Found\n\n`;
  
  if (analysis.routesWithoutEnforcement > 0) {
    markdown += `### ❌ Routes Without Enforcement (${analysis.routesWithoutEnforcement})\n\n`;
    const noEnforcement = reportData.filter(r => !r.hasEnforcement);
    for (const route of noEnforcement) {
      markdown += `- \`${route.apiRoute}\` - No assertReportAccess found\n`;
    }
    markdown += `\n`;
  }
  
  if (analysis.missingInLegacyMap.length > 0) {
    markdown += `### ⚠️ Routes Missing in Legacy Map (${analysis.missingInLegacyMap.length})\n\n`;
    markdown += `These routes are in the API but not mapped in Sidebar.tsx legacyRouteFeatureMap:\n\n`;
    for (const item of analysis.missingInLegacyMap) {
      markdown += `- \`${item.route}\` → Should map to \`${item.featureKey}\`\n`;
    }
    markdown += `\n`;
  }
  
  if (analysis.missingInSidebar.length > 0) {
    markdown += `### ⚠️ Sidebar Routes Without API Routes (${analysis.missingInSidebar.length})\n\n`;
    markdown += `These routes are in the sidebar but don't have corresponding API routes:\n\n`;
    for (const route of analysis.missingInSidebar) {
      markdown += `- \`${route}\`\n`;
    }
    markdown += `\n`;
  }
  
  // Detailed Report List
  markdown += `## 📋 Detailed Report List\n\n`;
  
  // Group by category
  const byCategory = {
    basic: reportData.filter(r => r.category === 'basic'),
    gst: reportData.filter(r => r.category === 'gst'),
    advanced: reportData.filter(r => r.category === 'advanced'),
    unknown: reportData.filter(r => !r.category)
  };
  
  for (const [category, reports] of Object.entries(byCategory)) {
    if (reports.length === 0) continue;
    
    const categoryName = category === 'basic' ? 'Basic Reports' : 
                        category === 'gst' ? 'GST Reports' : 
                        category === 'advanced' ? 'Advanced Reports' : 
                        'Unknown/No Enforcement';
    
    markdown += `### ${categoryName} (${reports.length})\n\n`;
    markdown += `| API Route | Sidebar Route | Category | Legacy Map | Plan Access |\n`;
    markdown += `|----------|---------------|----------|------------|------------|\n`;
    
    for (const report of reports) {
      const inLegacyMap = legacyMap[report.sidebarRoute] ? '✅' : '❌';
      const planAccess = report.featureKey ? 
        Object.entries(PLAN_FEATURES[report.featureKey])
          .filter(([_, has]) => has)
          .map(([plan]) => plan)
          .join(', ') : 'N/A';
      
      markdown += `| \`${report.apiRoute}\` | \`${report.sidebarRoute}\` | \`${report.category || 'N/A'}\` | ${inLegacyMap} | ${planAccess} |\n`;
    }
    markdown += `\n`;
  }
  
  // Plan Access Matrix
  markdown += `## 🎯 Plan Access Matrix\n\n`;
  markdown += `| Report Category | Free | Professional | Business | Enterprise |\n`;
  markdown += `|----------------|------|-------------|----------|-----------|\n`;
  
  for (const [category, featureKey] of Object.entries(CATEGORIES)) {
    const plans = PLAN_FEATURES[featureKey];
    markdown += `| ${category.toUpperCase()} | ${plans.free ? '✅' : '❌'} | ${plans.professional ? '✅' : '❌'} | ${plans.business ? '✅' : '❌'} | ${plans.enterprise ? '✅' : '❌'} |\n`;
  }
  markdown += `\n`;
  
  // Recommendations
  markdown += `## 💡 Recommendations\n\n`;
  
  if (analysis.missingInLegacyMap.length > 0) {
    markdown += `### 1. Add Missing Routes to Legacy Map\n\n`;
    markdown += `Add these entries to \`legacyRouteFeatureMap\` in \`Sidebar.tsx\`:\n\n`;
    markdown += `\`\`\`typescript\n`;
    for (const item of analysis.missingInLegacyMap) {
      markdown += `  '${item.route}': '${item.featureKey}',\n`;
    }
    markdown += `\`\`\`\n\n`;
  }
  
  if (analysis.routesWithoutEnforcement > 0) {
    markdown += `### 2. Add Enforcement to Routes Without It\n\n`;
    markdown += `The following routes need \`assertReportAccess\` calls:\n\n`;
    const noEnforcement = reportData.filter(r => !r.hasEnforcement);
    for (const route of noEnforcement) {
      markdown += `- \`${route.apiRoute}\`\n`;
    }
    markdown += `\n`;
  }
  
  // Write to file
  const outputDir = path.dirname(OUTPUT_FILE);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  fs.writeFileSync(OUTPUT_FILE, markdown, 'utf8');
}

// Run audit
runAudit();
