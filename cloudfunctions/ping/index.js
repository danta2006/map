// 云函数：连通性自测（部署后调用一次，能返回 env 就说明云开发通了）
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  return {
    ok: true,
    env: process.env.TCB_ENV || '',
    openid: wxContext.OPENID || '',
    appid: wxContext.APPID || '',
    echo: event || {},
    at: Date.now()
  };
};
