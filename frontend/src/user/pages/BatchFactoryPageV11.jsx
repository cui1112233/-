import { BatchFactoryV11UiPage } from './batch-factory-v11/BatchFactoryV11UiPage.jsx';

// Compatibility entry for historical V11 imports. The live route remains
// BatchFactoryPage.jsx; both entries render the same authoritative V11 page.
export default function BatchFactoryPageV11() {
  return <BatchFactoryV11UiPage />;
}
