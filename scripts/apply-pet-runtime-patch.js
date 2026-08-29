const fs = require('fs');

const file = 'frontend/src/shared/pet/StackyPet.jsx';
let source = fs.readFileSync(file, 'utf8');

const replacements = [
  ['title="唤醒 CM"', 'title={`唤醒 ${pet.displayName}`}'],
  ['aria-label="唤醒 CM"', 'aria-label={`唤醒 ${pet.displayName}`}'],
  ['aria-label={`前贴宠物 CM，${label}`}', 'aria-label={`前贴宠物 ${pet.displayName}，${label}`}'],
  ['role="dialog" aria-label="CM 互动"', 'role="dialog" aria-label={`${pet.displayName} 互动`}'],
  ['<strong>CM</strong>', '<strong>{pet.displayName}</strong>'],
  ['aria-label="关闭 CM 对话"', 'aria-label={`关闭 ${pet.displayName} 对话`}'],
  ['placeholder="问问 CM..." aria-label="向 CM 提问"', 'placeholder={`问问 ${pet.displayName}...`} aria-label={`向 ${pet.displayName} 提问`}'],
  ['aria-label="打开 CM 对话"', 'aria-label={`打开 ${pet.displayName} 对话`}'],
  ['title="拖动移动 CM"', 'title={`拖动移动 ${pet.displayName}`}'],
  ['aria-label="拖动移动 CM"', 'aria-label={`拖动移动 ${pet.displayName}`}'],
  ['title="收起 CM"', 'title={`收起 ${pet.displayName}`}'],
  ['aria-label="收起 CM"', 'aria-label={`收起 ${pet.displayName}`}']
];

for (const [search, replacement] of replacements) {
  if (!source.includes(search)) throw new Error(`Pet label patch point missing: ${search}`);
  source = source.replace(search, replacement);
}

fs.writeFileSync(file, source);
