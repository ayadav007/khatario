import { queryRows } from '@/lib/db';

export type OrgChartEmployee = {
  id: string;
  employee_code: string;
  name: string;
  designation: string | null;
  department: string | null;
  reporting_manager_id: string | null;
  is_active: boolean;
};

export type OrgChartNode = OrgChartEmployee & {
  children: OrgChartNode[];
};

export type OrgChartResult = {
  roots: OrgChartNode[];
  orphans: OrgChartNode[];
  cycleIds: string[];
};

function buildNodeMap(employees: OrgChartEmployee[]): Map<string, OrgChartNode> {
  const map = new Map<string, OrgChartNode>();
  for (const e of employees) {
    map.set(e.id, { ...e, children: [] });
  }
  return map;
}

function detectCycleIds(employees: OrgChartEmployee[]): Set<string> {
  const managerOf = new Map<string, string | null>();
  for (const e of employees) managerOf.set(e.id, e.reporting_manager_id);

  const inCycle = new Set<string>();
  for (const e of employees) {
    const visited = new Set<string>();
    let current: string | null = e.id;
    while (current) {
      if (visited.has(current)) {
        visited.forEach((id) => inCycle.add(id));
        break;
      }
      visited.add(current);
      current = managerOf.get(current) ?? null;
      if (current && !managerOf.has(current)) break;
    }
  }
  return inCycle;
}

export function buildOrgChartTree(employees: OrgChartEmployee[]): OrgChartResult {
  const cycleIds = [...detectCycleIds(employees)];
  const cycleSet = new Set(cycleIds);
  const validEmployees = employees.filter((e) => !cycleSet.has(e.id));
  const map = buildNodeMap(validEmployees);
  const ids = new Set(validEmployees.map((e) => e.id));

  const roots: OrgChartNode[] = [];
  const orphans: OrgChartNode[] = [];

  for (const e of validEmployees) {
    const node = map.get(e.id)!;
    const mgrId = e.reporting_manager_id;

    if (!mgrId || !ids.has(mgrId)) {
      if (mgrId && !ids.has(mgrId)) {
        orphans.push(node);
      } else {
        roots.push(node);
      }
      continue;
    }

    const parent = map.get(mgrId);
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortNodes = (nodes: OrgChartNode[]) => {
    nodes.sort((a, b) => a.name.localeCompare(b.name));
    for (const n of nodes) sortNodes(n.children);
  };
  sortNodes(roots);
  sortNodes(orphans);

  return { roots, orphans, cycleIds };
}

export async function fetchOrgChartEmployees(
  businessId: string,
  options?: { rootEmployeeId?: string; department?: string; activeOnly?: boolean }
): Promise<OrgChartEmployee[]> {
  let sql = `
    SELECT e.id, e.employee_code, u.name, e.designation, e.department,
           e.reporting_manager_id, e.is_active
    FROM employees e
    INNER JOIN users u ON u.id = e.id
    WHERE e.business_id = $1
  `;
  const params: unknown[] = [businessId];
  let idx = 2;

  if (options?.activeOnly !== false) {
    sql += ` AND e.is_active = true AND u.is_active = true`;
  }

  if (options?.department) {
    sql += ` AND e.department = $${idx++}`;
    params.push(options.department);
  }

  sql += ` ORDER BY u.name`;

  let employees = await queryRows<OrgChartEmployee>(sql, params);

  if (options?.rootEmployeeId) {
    const rootId = options.rootEmployeeId;
    const byId = new Map(employees.map((e) => [e.id, e]));
    const subtreeIds = new Set<string>();

    function collect(id: string) {
      if (subtreeIds.has(id)) return;
      subtreeIds.add(id);
      for (const e of employees) {
        if (e.reporting_manager_id === id) collect(e.id);
      }
    }

    if (byId.has(rootId)) {
      collect(rootId);
      employees = employees.filter((e) => subtreeIds.has(e.id));
    }
  }

  return employees;
}

export function filterTreeToRoot(tree: OrgChartResult, rootId: string): OrgChartResult {
  function findNode(nodes: OrgChartNode[]): OrgChartNode | null {
    for (const n of nodes) {
      if (n.id === rootId) return n;
      const found = findNode(n.children);
      if (found) return found;
    }
    return null;
  }

  const allNodes = [...tree.roots, ...tree.orphans];
  const root = findNode(allNodes);
  if (!root) return { roots: [], orphans: [], cycleIds: tree.cycleIds };
  return { roots: [root], orphans: [], cycleIds: tree.cycleIds };
}
