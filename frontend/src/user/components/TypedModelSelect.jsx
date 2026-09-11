import { Select } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { listAvailableModels } from '../../shared/api/modelCatalog';

const MODEL_KIND_LABELS = Object.freeze({
  text: '文本',
  video: '视频',
  image: '图片'
});

export function TypedModelSelect({ kind, value, onChange, disabled = false, placeholder }) {
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(false);
  const refresh = useCallback(async () => {
    setLoading(true);
    try { setModels(await listAvailableModels(kind)); } finally { setLoading(false); }
  }, [kind]);

  useEffect(() => { refresh(); }, [refresh]);

  return <Select
    value={value}
    onChange={onChange}
    onFocus={refresh}
    onDropdownVisibleChange={open => open && refresh()}
    disabled={disabled}
    loading={loading}
    placeholder={placeholder || (models.length ? '选择模型' : `尚未添加可用的${MODEL_KIND_LABELS[kind]}模型`)}
    options={models.map(model => ({ value: model.id, label: model.displayName }))}
  />;
}
