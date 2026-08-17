const http = require('http');
const fs = require('fs');
const path = require('path');

const API_BASE = 'http://127.0.0.1:3000';
const USERNAME = process.env.QIANTIE_USERNAME || 'choushiyiguai';
const PASSWORD = process.env.QIANTIE_PASSWORD;
if (!PASSWORD) {
  console.error('请通过环境变量 QIANTIE_PASSWORD 提供密码（源码不写默认密码）');
  process.exit(1);
}

const NOVEL_TEXT = `码头那把狙击出现时，九岁的我挡下了子弹，倒在赌王爷爷怀中。只因前世我替爷爷挡完枪后，再醒来所有人都在贺喜。可爸爸拿走我的功劳后，第一件事就是解决我和我妈，然后把养在夜总会的母子接回贺家。意识最后消失前，我听见她在门外对爸爸说："终于解决了。"再睁眼，我又站在旧港码头。爷爷刚从黑色宾利上下来。远处货柜缝隙里，一截冰冷的枪管，慢慢探了出来。`;

// 手动构造 Stage 1 提取结果（模拟人物场景提取输出）
const extractedData = {
  "时代背景": "现代都市",
  "人物": [
    {
      "姓名": "我（女童）",
      "别名": "",
      "角色定位": "主角",
      "身份标签": "女主·九岁女童·贺家大房之女·重生者",
      "性别": "女",
      "大致年龄": "9岁",
      "外貌描述": {
        "基本体征": "一位九岁的女童，身高约130cm身形瘦小单薄，肤色白皙偏苍白。",
        "五官与妆容": "圆脸偏尖下巴，眉形细淡，一双黑白分明的大眼眼神警觉超龄，鼻梁小巧，嘴唇偏薄无血色，素面朝天无妆容。",
        "发型与发饰": "黑色齐肩短发，刘海齐眉，发丝略显凌乱，无发饰。",
        "服饰与配饰": "身穿一件洗得发白的浅蓝色棉布童装连衣裙，领口微皱，脚穿白色帆布鞋略带泥渍。"
      },
      "性格关键词": ["警觉", "超龄成熟", "隐忍", "决绝"],
      "关系网络": "赌王爷爷的孙女，贺父的女儿，与夜总会女人是敌对关系",
      "说话风格": "话少沉静，语气平淡但每句都带分量",
      "在章节中的功能": "开篇钩子的核心人物，以挡枪动作引爆冲突"
    },
    {
      "姓名": "贺老爷子（赌王爷爷）",
      "别名": "爷爷、赌王",
      "角色定位": "重要配角",
      "身份标签": "贺家掌权者·赌王·爷爷",
      "性别": "男",
      "大致年龄": "65-70岁",
      "外貌描述": {
        "基本体征": "一位六七十岁的男性，身形硬朗挺拔，身高约175cm，肤色偏深。",
        "五官与妆容": "国字脸，浓眉压眼，眼窝深邃目光锐利，鼻梁高挺，嘴唇紧抿，面部皱纹深刻，气场压迫。",
        "发型与发饰": "花白短发，向后梳拢，鬓角微白。",
        "服饰与配饰": "身穿黑色定制西装三件套，白色衬衫配深灰领带，左手无名指戴一枚厚重的金戒指。"
      },
      "性格关键词": ["威严", "城府深", "杀伐决断"],
      "关系网络": "女童的爷爷，贺父的父亲，贺家最高权力者",
      "说话风格": "语气低沉有力，话不多但字字如钉",
      "在章节中的功能": "被保护对象，家族权力核心"
    },
    {
      "姓名": "贺父",
      "别名": "爸爸",
      "角色定位": "反派",
      "身份标签": "贺家大房·女童之父·背叛者",
      "性别": "男",
      "大致年龄": "35-40岁",
      "外貌描述": {
        "基本体征": "一位三四十岁的男性，身高约178cm身形修长，肤色偏白。",
        "五官与妆容": "长脸，剑眉星目但眼底冰冷无温，高鼻薄唇，面部线条硬朗冷峻。",
        "发型与发饰": "黑色短发，三七分，梳理整齐。",
        "服饰与配饰": "身穿深灰色西装，内搭白色衬衫，领带端正，袖扣银质低调。"
      },
      "性格关键词": ["冷漠", "算计", "虚伪"],
      "关系网络": "女童的父亲，贺老爷子的儿子，夜总会女人的情夫",
      "说话风格": "语气冷淡克制，公事公办的口吻",
      "在章节中的功能": "背叛者，推动女主命运转折"
    },
    {
      "姓名": "夜总会女人",
      "别名": "她",
      "角色定位": "反派",
      "身份标签": "贺父的情妇·夜总会出身·篡位者",
      "性别": "女",
      "大致年龄": "25-30岁",
      "外貌描述": {
        "基本体征": "一位二三十岁的女性，身高约165cm身形凹凸有致，肤色白皙。",
        "五官与妆容": "瓜子脸，细挑眉峰，狐狸眼眼尾上挑，鼻梁高挺，饱满红唇涂正红色口红，浓妆艳抹，眼神含笑带刀。",
        "发型与发饰": "深棕色大波浪长卷发，披散至腰际，一侧别在耳后露出钻石耳坠。",
        "服饰与配饰": "身穿酒红色丝绒紧身连衣裙，领口深V，腰间系金色细链腰带，脚踩黑色细高跟。"
      },
      "性格关键词": ["野心勃勃", "狠辣", "伪装"],
      "关系网络": "贺父的情妇，女童的敌人，她儿子的母亲",
      "说话风格": "笑意盈盈但话里藏刀，语气轻柔实则阴狠",
      "在章节中的功能": "最终反派，制造女主的死亡威胁"
    },
    {
      "姓名": "狙击手",
      "别名": "",
      "角色定位": "龙套",
      "身份标签": "暗杀者·狙击手",
      "性别": "男",
      "大致年龄": "未知",
      "外貌描述": {
        "基本体征": "",
        "五官与妆容": "",
        "发型与发饰": "",
        "服饰与配饰": "身穿深色行动服，面罩遮脸，只露出一双冷眼"
      },
      "性格关键词": ["冷血", "职业化"],
      "关系网络": "身份不明，在码头执行对贺老爷子的暗杀",
      "说话风格": "",
      "在章节中的功能": "开篇暗杀的执行者"
    }
  ],
  "场景": [
    {
      "场景编号": 1,
      "地点": "旧港码头",
      "时间": "白天/阴天",
      "出场人物": ["我（女童）", "贺老爷子（赌王爷爷）", "狙击手"],
      "核心事件": "狙击手暗杀贺老爷子，女童挡枪",
      "情绪基调": "紧张、生死一线",
      "冲突类型": "人物冲突"
    },
    {
      "场景编号": 2,
      "地点": "贺家门外昏暗走廊",
      "时间": "夜晚",
      "出场人物": ["我（女童）", "夜总会女人", "贺父"],
      "核心事件": "夜总会女人宣告胜利，女主意识消失",
      "情绪基调": "压抑、绝望",
      "冲突类型": "人物冲突"
    },
    {
      "场景编号": 3,
      "地点": "旧港码头（重生后）",
      "时间": "白天/阴天",
      "出场人物": ["我（女童）", "贺老爷子（赌王爷爷）"],
      "核心事件": "女主重生回到码头，枪管刚刚探出",
      "情绪基调": "紧迫、第二次机会",
      "冲突类型": "内心冲突+环境冲突"
    }
  ]
};

function requestJSON(pathname, payload, timeoutSec = 30, token = '') {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const url = new URL(API_BASE + pathname);
    const headers = {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body)
    };
    if (token) {
      headers.Authorization = 'Bearer ' + token;
    }

    const req = http.request(url, {
      method: 'POST',
      headers,
      timeout: timeoutSec * 1000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 300)}`));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch (error) {
          reject(new Error('Parse: ' + data.slice(0, 300)));
        }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.on('error', e => reject(e));
    req.write(body);
    req.end();
  });
}

async function login() {
  const data = await requestJSON('/api/login', { username: USERNAME, password: PASSWORD });
  if (!data.token) {
    throw new Error('Login response missing token');
  }
  return data.token;
}

function callAPI(token, requestPayload, timeoutSec = 180) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      ...requestPayload,
      max_tokens: 4096,
      temperature: 0.7,
      stream: false
    });

    const url = new URL(API_BASE + '/api/chat');
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        'Authorization': 'Bearer ' + token
      },
      timeout: timeoutSec * 1000
    };

    const req = http.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 300)}`));
          return;
        }
        try {
          const json = JSON.parse(data);
          if (json.error) reject(new Error(json.error));
          else if (json.choices?.[0]?.message) resolve(json.choices[0].message.content);
          else reject(new Error('Bad response: ' + data.slice(0, 300)));
        } catch (e) { reject(new Error('Parse: ' + data.slice(0, 300))); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.on('error', e => reject(e));
    req.write(body);
    req.end();
  });
}

async function main() {
  const token = await login();
  const charsJson = JSON.stringify(extractedData.人物, null, 2);
  const scenesJson = JSON.stringify(extractedData.场景, null, 2);
  
  console.log('Chars JSON length:', charsJson.length);
  console.log('Scenes JSON length:', scenesJson.length);

  const stage2Result = await callAPI(token, {
    promptType: 'script',
    mode: 'hook',
    format: 'storyboard',
    duration: '10s',
    novelText: NOVEL_TEXT,
    characters: charsJson,
    scenes: scenesJson
  }, 300);

  console.log(stage2Result);
  fs.writeFileSync(path.join(__dirname, 'test-output.txt'), stage2Result, 'utf8');
  console.log('\n--- 已保存到 test-output.txt ---');
}

main().catch(err => { console.error('错误:', err.message); process.exit(1); });
