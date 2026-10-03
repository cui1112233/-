function text(value) {
  return value == null ? '' : String(value).trim();
}

function deriveGenderFrom121Category(category) {
  const value = text(category);
  if (!value) return '';

  const male = /男频|男生|男性|男向/.test(value);
  const female = /女频|女生|女性|女向/.test(value);
  if (male === female) return '';
  return male ? '男频' : '女频';
}

function merge121BookInfoIntoMeta(meta, bookinfo) {
  const current = meta && typeof meta === 'object' && !Array.isArray(meta) ? { ...meta } : {};
  const info = bookinfo && typeof bookinfo === 'object' && !Array.isArray(bookinfo) ? bookinfo : {};
  const category = text(info.category);

  if (category) current.category = category;
  if (info.genre !== undefined && info.genre !== null && info.genre !== '') current.genre = info.genre;

  // User/input values always win. 121 is only a fill-only source.
  if (text(current.gender)) return current;

  const gender = deriveGenderFrom121Category(category);
  if (gender) {
    current.gender = gender;
    current.genderSource = '121_category';
  }
  return current;
}

module.exports = { deriveGenderFrom121Category, merge121BookInfoIntoMeta };
