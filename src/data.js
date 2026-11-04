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

const BANNED = [
  '씨발', '시발', 'ㅅㅂ', 'ㅆㅂ', '병신', 'ㅂㅅ', '개새끼', '새끼', '좆', '존나', 'ㅈㄴ', '지랄', '미친놈', '미친년',
  '닥쳐', '꺼져', '죽어', 'fuck', 'shit', 'bitch', 'asshole', 'dick', 'cunt',
];

export function cleanMessage(raw) {
  let s = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 30);
  for (const w of BANNED) {
    const re = new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    s = s.replace(re, '♡');
  }
  return s;
}
