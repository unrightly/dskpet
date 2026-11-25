'use strict';

const { DEFAULT_BUBBLES } = require('./defaults');

const POOLS = {
  dawn: {
    label: '清晨',
    hint: '刚醒来的清晨，安静、微凉，适合慢慢开始',
    lines: [
      '早上好呀，{time} 了。窗帘拉开一点点，光会溜进来。',
      '我刚在键盘上踩了一圈，今天的按键手感不错。',
      '先喝口温水再忙嘛，喉咙会谢谢你。',
      '今天要做的第一件事，想好了吗？想不好也没关系。',
      '窗外好像很安静，适合慢慢醒过来。',
      '你昨晚的梦还记得吗？我反正是梦见小鱼干了。',
      '如果今天有点难，就先从刷牙开始。',
      '我把尾巴晒在屏幕边上，暖烘烘的。'
    ]
  },
  morning: {
    label: '上午',
    hint: '上午的工作时段，注意力集中，容易忘记休息',
    lines: [
      '{time} 啦，盯屏幕久了记得眨眨眼。',
      '我刚刚打了个哈欠，传染给你了吗？',
      '水杯空了吧？去接一杯，顺便走两步。',
      '如果有什么一直拖着的小事，现在花两分钟解决它？',
      '你认真起来的样子，有点帅哦。',
      '我在旁边数光标闪了多少下，已经数不清了。',
      '肩膀是不是又耸起来了？放松一点点。',
      '今天的进度条，走到哪里啦？'
    ]
  },
  noon: {
    label: '午间',
    hint: '午饭时间，适合吃饭、休息、短暂放空',
    lines: [
      '{time} 了，吃饭了吗？别用零食糊弄自己。',
      '吃完靠一会儿，闭眼五分钟也算休息。',
      '我闻到屏幕那边好像有饭香（并没有）。',
      '午后的太阳最适合发呆三分钟。',
      '如果困，就眯一会儿，我帮你看着时间。',
      '今天吃到什么好吃的了吗？待会儿讲给我听。',
      '饭后别立刻趴着，站一会儿再睡。'
    ]
  },
  afternoon: {
    label: '下午',
    hint: '下午最容易犯困的时段，适合补水、伸展、重启注意力',
    lines: [
      '{time} 了，下午最容易犯困的时间到啦。',
      '站起来伸个懒腰，手臂举高一点。',
      '眼睛看远处二十秒，真的有用。',
      '我刚刚追着自己的尾巴转了一圈，现在有点晕。',
      '喝口水吧，你已经很久没理杯子了。',
      '如果卡住了，就把问题说给我听，说不定会顺一点。',
      '今天的待办还剩几件？挑最小的一件先做。',
      '窗外的云换形状了，你错过了。'
    ]
  },
  dusk: {
    label: '傍晚',
    hint: '天色渐暗的傍晚，适合收尾、吃饭、慢下来',
    lines: [
      '{time} 了，天色要暗下来啦。',
      '今天辛苦啦，先把肩膀放下来。',
      '晚饭别太晚，胃会闹脾气的。',
      '我刚刚在桌角打了个滚，位置刚刚好。',
      '如果要加班，记得给自己留一盏暖一点的灯。',
      '把今天最开心的一件小事找出来，存好。',
      '回家路上注意安全（如果你还在外面）。'
    ]
  },
  night: {
    label: '夜晚',
    hint: '入夜后的放松时段，适合聊天、收尾、准备休息',
    lines: [
      '{time} 了，今天过得怎么样？',
      '灯光调暗一点，眼睛会舒服些。',
      '如果还在忙，给自己设个收尾时间吧。',
      '我有点困了，但可以再陪你一会儿。',
      '今天有没有什么想说又没说出口的话？',
      '睡前别再刷太久啦，脑子需要关机。',
      '把明天要做的第一件事写下来，然后就可以休息了。'
    ]
  },
  midnight: {
    label: '深夜',
    hint: '深夜，四周很安静，该睡了，语气轻一点',
    lines: [
      '{time} 了…真的该睡了哦。',
      '熬夜的账单，明天会寄到的。',
      '最后看一眼，然后关灯，好不好？',
      '我已经把尾巴盖在脸上了，准备睡了。',
      '如果睡不着，试试把呼吸放慢一点。',
      '今晚的月亮应该很好看，但别看太久。',
      '明天的事交给明天的你，今晚先休息。'
    ]
  }
};

function getTimeContext(now = new Date()) {
  const hour = now.getHours();
  let key = 'night';
  if (hour >= 5 && hour < 9) key = 'dawn';
  else if (hour >= 9 && hour < 12) key = 'morning';
  else if (hour >= 12 && hour < 14) key = 'noon';
  else if (hour >= 14 && hour < 18) key = 'afternoon';
  else if (hour >= 18 && hour < 20) key = 'dusk';
  else if (hour >= 20 && hour < 23) key = 'night';
  else key = 'midnight';

  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return {
    ...POOLS[key],
    key,
    hour,
    time: `${hh}:${mm}`,
    date: now
  };
}

function pickBubble({ persona, now = new Date(), recent = [] } = {}) {
  const ctx = getTimeContext(now);
  const extra = Array.isArray(persona?.bubbles) ? persona.bubbles : [];
  const pool = [...ctx.lines, ...extra, ...DEFAULT_BUBBLES];
  const recentSet = new Set(recent);
  let candidates = pool.filter((line) => !recentSet.has(line));
  if (!candidates.length) candidates = pool;
  const raw = candidates[Math.floor(Math.random() * candidates.length)] || DEFAULT_BUBBLES[0];
  return raw.replace(/\{time\}/g, ctx.time);
}

function buildSmartBubblePrompt({ persona, now = new Date(), mood = 'idle' } = {}) {
  const ctx = getTimeContext(now);
  const name = persona?.name || '桌宠';
  const personality = String(persona?.persona || '').split('\n').slice(0, 3).join('；').slice(0, 180);
  return [
    `你是「${name}」。角色设定：${personality || '一只住在桌面角落的小宠物，关心主人。'}`,
    `现在是 ${ctx.time}（${ctx.label}）。氛围：${ctx.hint}。`,
    `你现在的状态：${mood}。`,
    '请说一句无关紧要的日常小提醒或碎碎念，像随口冒出来的一样。',
    '要求：不超过 26 个汉字；不要提问；不要用引号；不要提到 AI；不要重复常规的"多喝水"原句。',
    '只输出这句话。'
  ].join('\n');
}

module.exports = {
  POOLS,
  getTimeContext,
  pickBubble,
  buildSmartBubblePrompt
};
