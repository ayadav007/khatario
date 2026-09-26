export type ReleaseCommit = {
  sha: string;
  shortSha: string;
  subject: string;
  date: string | null;
};

export type StagingProductionDiff = {
  thisHost: string;
  thisBranch: string | null;
  thisSha: string | null;
  stagingRef: string;
  productionRef: string;
  source: 'github' | 'git';
  aheadBy: number;
  commitsOnStagingNotProduction: ReleaseCommit[];
  hint: string | null;
};
