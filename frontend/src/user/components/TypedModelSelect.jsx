import { Select } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { getTypedModelSelectState, refreshAvailableModels } from '../../shared/api/modelCatalog';

export function TypedModelSelect({ kind, value, onChange, disabled = false, placeholder }) {
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const selectState = getTypedModelSelectState(kind, { models, error });
  const refresh = useCallback(async () => {
    setLoading(true);
    const result = await refreshAvailableModels(kind);
    setModels(result.models);
    setError(result.error);
    setLoading(false);
  }, [kind]);

  useEffect(() => { refresh(); }, [refresh]);

  return <Select
    value={value}
    onChange={onChange}
    onFocus={refresh}
    onDropdownVisibleChange={open => open && refresh()}
    disabled={disabled || !selectState.validKind}
    loading={loading}
    placeholder={placeholder || selectState.placeholder}
    options={selectState.models.map(model => ({ value: model.id, label: model.displayName }))}
  />;
}
