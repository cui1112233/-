const fs = require('fs');

const file = 'frontend/src/shared/pet/StackyPet.jsx';
let source = fs.readFileSync(file, 'utf8');

const search = `  useEffect(() => {\n    let cancelled = false;\n\n    getConfig()\n      .then(config => {`;
const replacement = `  useEffect(() => {\n    let cancelled = false;\n\n    if (!username) {\n      setPet(getPetDefinition(DEFAULT_PET_ID));\n      return undefined;\n    }\n\n    getConfig()\n      .then(config => {`;

if (!source.includes(search)) throw new Error('Pet config effect patch point missing');
source = source.replace(search, replacement);
fs.writeFileSync(file, source);
