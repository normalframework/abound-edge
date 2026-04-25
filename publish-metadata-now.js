const publishMeta = require("./publish-metadata");
module.exports = async (ctx) => publishMeta({ ...ctx, args: { ...(ctx.args || {}), force: "true" } });
