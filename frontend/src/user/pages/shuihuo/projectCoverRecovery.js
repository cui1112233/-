import { batchFactoryFallbackCoverFromProductionStatus } from './batchFactoryProjects.js';

export async function recoverProjectCover(batchId, loadProduction) {
  try {
    return batchFactoryFallbackCoverFromProductionStatus(await loadProduction(batchId));
  } catch {
    return null;
  }
}
