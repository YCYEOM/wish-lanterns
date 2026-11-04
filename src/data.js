// Static content: lantern colours, preset phrases, warm messages for virtual lanterns, word filter.

// css: the UI swatch, matched to how the lit lantern reads on screen; hex: glow tint; lamp: the deeper paper colour the 3D lantern is lit with (pastels wash out to white once lit)
export const COLORS = [
  { id: 'amber', name: '주황', hex: 0xffa24a, css: '#ffa24a' },
  { id: 'rose', name: '분홍', hex: 0xff8fb0, lamp: 0xff6a98, css: '#f0809c' },
  { id: 'sky', name: '하늘', hex: 0x8fd0ff, lamp: 0x3f9cff, css: '#5fa6ee' },
  { id: 'mint', name: '연두', hex: 0xb4f08a, lamp: 0x72d84a, css: '#92d65c' },
  { id: 'lilac', name: '보라', hex: 0xc6a2ff, lamp: 0x9a5cff, css: '#a66cf2' },
];

export const PRESETS = [
  '오늘도 수고했어',
  '다 잘 될 거야',
  '보고 싶어',
  '고마워',
  '건강하게 지내자',
  '푹 자고 싶다',
];

export const WARM_MESSAGES = [
  '오늘 하루도 잘 버텼어요',
  '내일은 조금 더 가벼운 하루이길',
  '엄마 아빠 오래오래 건강하세요',
  '시험 잘 보게 해주세요',
  '천천히 가도 괜찮아',
  '다들 따뜻한 밤 보내요',
  '우리 강아지 보고 싶다',
  '올해는 꼭 여행 가기',
  '좋아하는 사람이 행복했으면',
  '고마웠다고 전하고 싶어요',
  '쉬어가도 괜찮아요',
  '오늘 웃은 일 하나 있었어',
  '모두 아프지 말기',
  '새 출발 응원해 주세요',
  '언젠가 다시 만나요',
  '지금 이대로도 충분해',
  '첫 월급 받았어요!',
  '별이 예쁜 밤이네요',
  '이사 간 집에 빨리 정들기를',
  '할머니 사랑해요',
  '조금씩 나아지고 있어',
  '',
  '',
  '같이 있어서 다행이야',
  '내 마음이 잘 닿기를',
  '수고했어, 나 자신',
  '봄이 빨리 왔으면',
  '친구야 생일 축하해',
];

// banned words are matched on a "skeleton" of the message: spaces, dots, digits, symbols and emoji between
// letters are skipped and look-alike characters folded (1->i, 0->o, $->s, @->a ...), so "시 1 발", "f.u.c.k"
// and "ㅅ_ㅂ" are caught too; the whole span in the original text becomes ♡
const BANNED = [
  '씨발', '시발', '씨빨', '씌발', '씨바', '시빨', '쓰발', '씨팔', '시팔', 'ㅅㅂ', 'ㅆㅂ', 'ㅆㅃ', 'ㅅㅃ',
  '병신', '븅신', '빙신', 'ㅂㅅ', 'ㅄ', '개새끼', '개색', '개세끼', '새끼', '쌔끼', 'ㅅㄲ', '좆', '좃', '좇', '존나', '졸라', 'ㅈㄴ',
  '지랄', 'ㅈㄹ', '미친놈', '미친년', '미친새', '닥쳐', '꺼져', '니미', '니애미', '느금', '엠창', '애미', '애비',
  'fuck', 'fck', 'fuk', 'shit', 'bitch', 'asshole', 'dick', 'cunt', 'nigger', 'nigga', 'retard', 'slut', 'whore', 'pussy',
];
const FOLD = { '1': 'i', '!': 'i', '|': 'i', '0': 'o', '3': 'e', '4': 'a', '@': 'a', '$': 's', '5': 's', '7': 't', '8': 'b' };
const SKIP = /[\s.,_\-~*+=/\\'"`^:;()\[\]{}<>?#%&2069\u200b-\u200f\u3164\p{Extended_Pictographic}]/u;

export function cleanMessage(raw) {
  let s = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 30);
  const chars = [...s];
  const hide = new Array(chars.length).fill(false);
  // two skeletons: one that folds digits/symbols into look-alike letters (for latin words), one that skips
  // them (for Korean); each also in a form with repeated letters collapsed ("shiiit" -> "shit")
  for (const fold of [true, false]) {
    const sk = [], at = [];
    chars.forEach((ch, i) => {
      const low = ch.toLowerCase();
      const f = fold ? FOLD[low] : null;
      if (!f && (SKIP.test(ch) || /[0-9]/.test(ch) || (!fold && FOLD[low]))) return;
      sk.push(f || low); at.push(i);
    });
    const cs = [], cat = [];
    sk.forEach((c, k) => { if (c !== sk[k - 1] || /[가-힣ㄱ-ㅎ]/.test(c)) { cs.push(c); cat.push(at[k]); } else cat[cat.length - 1] = at[k]; });
    for (const [skel, pos, first] of [[sk.join(''), at, at], [cs.join(''), cat, null]]) {
      for (const w of BANNED) {
        let k = skel.indexOf(w);
        while (k !== -1) {
          const startI = first ? pos[k] : (k === 0 ? 0 : cat[k - 1] + 1);
          for (let j = Math.max(startI, 0); j <= pos[k + w.length - 1]; j++) if (!/\s/.test(chars[j]) || j > startI) hide[j] = true;
          k = skel.indexOf(w, k + 1);
        }
      }
    }
  }
  let out = '', prev = false;
  chars.forEach((ch, i) => { if (hide[i]) { if (!prev) out += '♡'; prev = true; } else { out += ch; prev = false; } });
  return out;
}
