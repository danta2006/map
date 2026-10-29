// 云函数：用户反馈（服务端清洗 + 限条数）
// 小程序端不再直接写 feedback 集合，统一走这里；集合权限可收紧到「仅管理端可写」
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const MAX_TEXT = 500;
const MAX_CONTACT = 100;
const MAX_PER_USER = 50; // 每人最多留 50 条，挡刷库

function clean(s, max) {
  return String(s == null ? '' : s).trim().slice(0, max);
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { ok: false, error: '没有拿到身份，请在小程序里提交' };

  const e = event || {};
  const text = clean(e.text, MAX_TEXT);
  if (text.length < 5) return { ok: false, error: '内容太短，至少写 5 个字' };

  const contact = clean(e.contact, MAX_CONTACT);
  const placeId = clean(e.placeId, 60);
  const placeName = clean(e.placeName, 60);
  const page = clean(e.page, 20);

  try {
    await db.createCollection('feedback');
  } catch (err) {
    // 已存在会报错，忽略
  }

  const cnt = await db.collection('feedback').where({ openid: OPENID }).count();
  if (cnt.total >= MAX_PER_USER) return { ok: false, error: '提交太多了，请明天再试' };

  const res = await db.collection('feedback').add({
    data: {
      text,
      contact,
      placeId,
      placeName,
      page,
      at: Date.now(),
      status: 'new',
      openid: OPENID
    }
  });
  return { ok: true, id: res._id };
};
