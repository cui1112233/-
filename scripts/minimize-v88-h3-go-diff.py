from pathlib import Path
import subprocess

FILES = [
    'backend/internal/batchfactoryv11/video_provider.go',
    'backend/internal/batchfactoryv11/production.go',
    'backend/internal/httpapi/router.go',
    'backend/internal/httpapi/batch_factory_v11_production.go',
]


def base_file(path):
    return subprocess.check_output(['git', 'show', f'origin/v88:{path}'], text=True)


def patch(text, old, new, path):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected one match, got {count}')
    return text.replace(old, new, 1)

for path in FILES:
    Path(path).write_text(base_file(path), encoding='utf-8')

path = FILES[0]
text = Path(path).read_text(encoding='utf-8')
text = patch(text,
    '\tVideoProviderDoubaoLocal       = "doubao_local_executor"\n\tPersonalVideoProviderID',
    '\tVideoProviderDoubaoLocal       = "doubao_local_executor"\n\tVideoProviderAutoDLComfyUI     = "autodl_comfyui"\n\tPersonalVideoProviderID', path)
text = patch(text,
    '\tcase "doubao", "doubao_local", "doubao_local_executor", "local-doubao-executor-video":\n\t\treturn VideoProviderDoubaoLocal\n\tdefault:',
    '\tcase "doubao", "doubao_local", "doubao_local_executor", "local-doubao-executor-video":\n\t\treturn VideoProviderDoubaoLocal\n\tcase "autodl", "autodl_comfyui":\n\t\treturn VideoProviderAutoDLComfyUI\n\tdefault:', path)
Path(path).write_text(text, encoding='utf-8')

path = FILES[1]
text = Path(path).read_text(encoding='utf-8')
text = patch(text,
    'func (s *ProductionService) resolveProvider(ctx context.Context, owner, provider string) (ProductionAdapter, FrozenVideoModel, error) {',
    '''func (s *ProductionService) HasServerManagedVideoProvider(provider string) bool {
\tif s == nil { return false }
\tprovider = normalizeVideoProvider(provider)
\treturn provider == VideoProviderAutoDLComfyUI && s.Adapter != nil && strings.TrimSpace(s.Model.ID) == VideoModelMiniMaxH3
}

func (s *ProductionService) resolveProvider(ctx context.Context, owner, provider string) (ProductionAdapter, FrozenVideoModel, error) {''', path)
text = patch(text,
    '''\tif provider != VideoProviderPersonalAPI {
\t\treturn nil, FrozenVideoModel{}, fmt.Errorf("%w: unsupported video provider", ErrInvalid)
\t}
''',
    '''\tif provider == VideoProviderAutoDLComfyUI {
\t\tif !s.HasServerManagedVideoProvider(provider) {
\t\t\treturn nil, FrozenVideoModel{}, fmt.Errorf("%w: MiniMax H3 server-managed provider is unavailable", ErrUnavailable)
\t\t}
\t\tmodel := s.Model
\t\tmodel.ID = VideoModelMiniMaxH3
\t\tif model.MaxDuration <= 0 { model.MaxDuration = 15 }
\t\treturn s.Adapter, model, nil
\t}
\tif provider != VideoProviderPersonalAPI {
\t\treturn nil, FrozenVideoModel{}, fmt.Errorf("%w: unsupported video provider", ErrInvalid)
\t}
''', path)
Path(path).write_text(text, encoding='utf-8')

path = FILES[2]
text = Path(path).read_text(encoding='utf-8')
route = '\tv11.HandleFunc("GET /api/batch-factory/v11/capabilities", capabilityHandlerForRuntime(options.Slice, options.Production != nil && options.Production.Enabled, options.Merge != nil && options.Merge.Enabled, options.External != nil && options.External.Enabled[external.Provider121], options.External != nil && options.External.Enabled[external.ProviderYadi]))\n'
text = patch(text, route, route + '\tv11.HandleFunc("GET /api/batch-factory/v11/video-models", videoModelCatalogHandler)\n', path)
Path(path).write_text(text, encoding='utf-8')

path = FILES[3]
text = Path(path).read_text(encoding='utf-8')
text = patch(text,
    '''\t\tvar input videoProviderConfigInput
\t\tif !decodeJSON(w, r, &input) { return }
\t\terr := service.ProviderRegistry.Put(r.Context(), owner, batchfactoryv11.VideoProviderConfig{
''',
    '''\t\tvar input videoProviderConfigInput
\t\tif !decodeJSON(w, r, &input) { return }
\t\tprovider := batchfactoryv11.NormalizeVideoProviderForHTTP(input.Provider)
\t\tif provider == batchfactoryv11.VideoProviderAutoDLComfyUI {
\t\t\twriteJSON(w, http.StatusBadRequest, map[string]string{"error":"MiniMax H3 使用服务端环境变量配置，浏览器不能写入凭据", "code":"H3_PROVIDER_CONFIG_SERVER_MANAGED"})
\t\t\treturn
\t\t}
\t\terr := service.ProviderRegistry.Put(r.Context(), owner, batchfactoryv11.VideoProviderConfig{
''', path)
text = patch(text,
    '\t\tprovider := batchfactoryv11.NormalizeVideoProviderForHTTP(input.Provider)\n\t\tmodel := input.Model\n',
    '\t\tmodel := input.Model\n', path)
text = patch(text,
    '''\t\tprovider := batchfactoryv11.NormalizeVideoProviderForHTTP(r.URL.Query().Get("provider"))
\t\tif service == nil || service.ProviderRegistry == nil { writeStoreError(w, batchfactoryv11.ErrUnavailable); return }
''',
    '''\t\tprovider := batchfactoryv11.NormalizeVideoProviderForHTTP(r.URL.Query().Get("provider"))
\t\tif provider == batchfactoryv11.VideoProviderAutoDLComfyUI {
\t\t\tconfigured := service != nil && service.HasServerManagedVideoProvider(provider)
\t\t\twriteJSON(w, http.StatusOK, batchfactoryv11.VideoProviderConfigView{Provider: provider, Model: batchfactoryv11.VideoModelMiniMaxH3, Configured: configured})
\t\t\treturn
\t\t}
\t\tif service == nil || service.ProviderRegistry == nil { writeStoreError(w, batchfactoryv11.ErrUnavailable); return }
''', path)
Path(path).write_text(text, encoding='utf-8')

print('MINIMAL_H3_GO_DIFF_READY')
