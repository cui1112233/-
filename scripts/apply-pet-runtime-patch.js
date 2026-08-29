const fs = require('fs');

const file = 'frontend/src/shared/pet/StackyPet.jsx';
let source = fs.readFileSync(file, 'utf8');

function replaceOnce(search, replacement, label) {
  if (!source.includes(search)) throw new Error(`StackyPet patch point missing: ${label}`);
  source = source.replace(search, replacement);
}

replaceOnce(
  "import { askAgent, createAgentTask, getAgentTask } from '../api/agent';\n",
  "import { askAgent, createAgentTask, getAgentTask } from '../api/agent';\nimport { getConfig } from '../api/config';\n",
  'config import'
);

replaceOnce(
  "import { didDrag, getOverlayLayout, PET_SIZE } from './overlayGeometry';\n",
  "import { didDrag, getOverlayLayout, PET_SIZE } from './overlayGeometry';\nimport { DEFAULT_PET_ID, PET_SELECTION_EVENT, getPetDefinition } from './petCatalog';\n",
  'pet catalog import'
);

replaceOnce(
  "export function StackyPet({ username, accountSessionKey }) {\n  const [state, setState] = useState('idle');",
  "export function StackyPet({ username, accountSessionKey }) {\n  const [pet, setPet] = useState(() => getPetDefinition(DEFAULT_PET_ID));\n  const [state, setState] = useState('idle');",
  'pet state'
);

replaceOnce(
  "  }, [accountSessionKey, username]);\n\n  useEffect(() => {\n    function handlePetState(event) {",
  `  }, [accountSessionKey, username]);\n\n  useEffect(() => {\n    let cancelled = false;\n\n    getConfig()\n      .then(config => {\n        if (!cancelled) setPet(getPetDefinition(config?.pet));\n      })\n      .catch(() => {\n        if (!cancelled) setPet(getPetDefinition(DEFAULT_PET_ID));\n      });\n\n    function handlePetSelection(event) {\n      setPet(getPetDefinition(event.detail?.pet || event.detail?.id));\n    }\n\n    window.addEventListener(PET_SELECTION_EVENT, handlePetSelection);\n    return () => {\n      cancelled = true;\n      window.removeEventListener(PET_SELECTION_EVENT, handlePetSelection);\n    };\n  }, [accountSessionKey, username]);\n\n  useEffect(() => {\n    function handlePetState(event) {`,
  'pet config effect'
);

const oldImage = '<img src="/pets/stacky/spritesheet.webp" alt="" />';
const newImage = '<img src={pet.spritesheetPath} alt="" style={{ imageRendering: pet.renderMode === \'smooth\' ? \'auto\' : undefined }} />';
const imageCount = source.split(oldImage).length - 1;
if (imageCount !== 2) throw new Error(`Expected 2 hard-coded Stacky images, found ${imageCount}`);
source = source.split(oldImage).join(newImage);

fs.writeFileSync(file, source);
