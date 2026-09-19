module.exports = async function githubDisabled(req, res) {
  res.statusCode = 410;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({
    error: 'GitHub entegrasyonu devre dışı bırakıldı.',
    code: 'GITHUB_INTEGRATION_DISABLED'
  }));
};
