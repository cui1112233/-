export const SHOWCASE_BATCH = {
  id: 'BF-V11-DEMO-001',
  title: '批次 20260831-01',
  count: 100,
  mode: 'viral',
  configVersion: '批量配置 V3.2',
  latestConfigVersion: '批量配置 V3.5',
  videoModel: 'Seedance Video Pro · 最大 15s',
  aspectRatio: '9:16',
  fixedSingleVideo: false,
  status: '制作中'
};

const makeVideos = (bookId, count, state = 'ready') => Array.from({ length: count }, (_, index) => ({
  id: `${bookId}-video-${index + 1}`,
  label: `VIDEO ${String(index + 1).padStart(2, '0')}`,
  duration: [8, 12, 10, 13][index % 4],
  status: state === 'failed' && index === 1 ? '异常' : index % 3 === 0 ? '已完成' : index % 3 === 1 ? '待生成' : '排队中',
  visualPrompt: `镜头 ${index + 1}：保持人物一致性，强化当前剧情冲突与动作表现，画面围绕本段小说内容推进。`,
  characters: index % 2 === 0 ? ['林晚', '顾沉'] : ['林晚'],
  scenes: index % 2 === 0 ? ['顾家客厅'] : ['医院走廊'],
  props: index % 2 === 0 ? ['手机', '文件袋'] : ['病历单']
}));

export const SHOWCASE_BOOKS = [
  {
    id: 'book-01', bookId: '2074141710842647315', platform: '番茄', title: '离婚后她不回头了', status: '待审核', overrideCount: 0,
    sourceText: '林晚站在客厅中央，看着桌上那份已经签好的离婚协议。三年的婚姻，在这一刻终于走到了尽头。',
    hookText: '“签啊！”男人把离婚协议狠狠摔在桌上。林晚却笑了，她等这一天，已经整整三年。',
    assets: { characters: ['林晚', '顾沉', '顾母'], scenes: ['顾家客厅', '医院走廊'], props: ['离婚协议', '手机'] },
    videos: makeVideos('2074141710842647315', 4)
  },
  {
    id: 'book-02', bookId: '2074141710842647316', platform: '番茄', title: '重生后我让全家后悔', status: 'AI处理中', overrideCount: 2,
    sourceText: '再次睁眼，她回到了十八岁那年。门外，全家还在逼她把大学名额让给妹妹。',
    hookText: '上一世她让出大学名额，换来的却是一场精心准备的葬礼。这一次，她当着所有人的面撕碎了申请书。',
    assets: { characters: ['苏念', '苏父', '苏母'], scenes: ['苏家餐厅', '学校办公室'], props: ['录取通知书'] },
    videos: makeVideos('2074141710842647316', 3)
  },
  {
    id: 'book-03', bookId: '2074141710842647317', platform: '番茄', title: '矿井深处的秘密', status: '待生成', overrideCount: 0,
    sourceText: '崔十一握紧口袋里的U盘，远处矿灯一盏盏熄灭。今晚，他必须把那份名单送出去。',
    hookText: '',
    assets: { characters: ['崔十一', '老周'], scenes: ['井下巷道', '矿区办公室'], props: ['U盘', '安全台账'] },
    videos: makeVideos('2074141710842647317', 5)
  },
  {
    id: 'book-04', bookId: '2074141710842647318', platform: '番茄', title: '新婚夜婆婆让我跪下', status: '异常', overrideCount: 1,
    sourceText: '喜烛还在燃着，苏氏已经跪在堂前。所有宾客都在看她，而老夫人的茶盏停在半空。',
    hookText: '新婚第一夜，婆婆当着满堂宾客逼她下跪。她抬起头，只问了一句：“这就是你们沈家的规矩？”',
    assets: { characters: ['苏氏', '沈老夫人'], scenes: ['喜堂'], props: ['茶盏', '红烛'] },
    videos: makeVideos('2074141710842647318', 3, 'failed')
  },
  {
    id: 'book-05', bookId: '2074141710842647319', platform: '番茄', title: '摄政王来猪肉摊了', status: '待合并', overrideCount: 0,
    sourceText: '宋溪手里的剁骨刀停在半空。摊前那个穿玄色蟒袍的男人，居然端起了她的粗茶碗。',
    hookText: '',
    assets: { characters: ['宋溪', '裴砚'], scenes: ['猪肉摊'], props: ['剁骨刀', '粗茶碗'] },
    videos: makeVideos('2074141710842647319', 4)
  },
  {
    id: 'book-06', bookId: '2074141710842647320', platform: '番茄', title: '带着嫁妆离开那天', status: '已合并', overrideCount: 3,
    sourceText: '晏挽把最后一只箱笼抬上马车。府门里的人终于追了出来，可她没有回头。',
    hookText: '',
    assets: { characters: ['晏挽', '崔珩'], scenes: ['侯府门前'], props: ['香囊', '嫁妆箱'] },
    videos: makeVideos('2074141710842647320', 3)
  }
];

export const SHOWCASE_STATUS_ORDER = ['全部', '待开始', '待审核', 'AI处理中', '待生成', '排队中', '生成中', '异常', '待合并', '已合并', '待上传', '已发布'];

export const SHOWCASE_BATCH_SETTINGS = {
  configVersion: 'v3.2',
  productionMode: 'viral',
  scriptPromptPresetId: 'standard-short-drama',
  assetPromptPresetId: 'standard-asset-extraction',
  videoModelId: 'seedance-pro',
  aspectRatio: '9:16',
  durationMode: 'auto',
  fixedSingleVideo: false,
  prefixMode: 'auto',
  customPrefix: '电影感动态分镜，人物一致性稳定',
  subtitlePolicy: 'forbid-auto-dialogue-subtitle',
  injectCharacterPrompt: true,
  injectScenePrompt: true,
  injectPropPrompt: true,
  prefixEnabled: true,
  qualityEnabled: true,
  restrictionEnabled: true,
  negativeEnabled: true,
  quality: '高细节，电影级光影，人物五官稳定，动作自然。',
  restriction: '避免镜头跳轴，避免人物服装无理由变化，剧情必要文字除外。',
  negative: '低清晰度，肢体畸形，多余手指，错误文字，水印。'
};
