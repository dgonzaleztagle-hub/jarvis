const test = require('node:test');
const assert = require('node:assert/strict');
const { parseFirstVideo, searchYoutube } = require('../src/connectors/youtube');

test('parseFirstVideo extrae primer resultado con titulo desde ytInitialData', () => {
  const html = `
    <script>
      var ytInitialData = {"videoId":"abcDEF12345","title":{"runs":[{"text":"Cancion de prueba"}]}};
    </script>
  `;
  const video = parseFirstVideo(html);
  assert.deepEqual(video, {
    videoId: 'abcDEF12345',
    title: 'Cancion de prueba',
    url: 'https://www.youtube.com/watch?v=abcDEF12345'
  });
});

test('parseFirstVideo cae a watch url si no encuentra titulo estructurado', () => {
  const video = parseFirstVideo('<a href="/watch?v=ZYXwvUT9876">ver</a>');
  assert.equal(video.videoId, 'ZYXwvUT9876');
  assert.equal(video.title, 'YouTube video');
});

test('searchYoutube usa fetch inyectado y devuelve null ante error', async () => {
  const ok = await searchYoutube('tema', {
    fetchImpl: async (url) => {
      assert.match(url, /search_query=tema/);
      return {
        ok: true,
        text: async () => '{"videoId":"abcDEF12345","title":{"simpleText":"Resultado simple"}}'
      };
    }
  });
  assert.equal(ok.videoId, 'abcDEF12345');
  assert.equal(ok.title, 'Resultado simple');

  const down = await searchYoutube('tema', {
    fetchImpl: async () => ({ ok: false, text: async () => '' })
  });
  assert.equal(down, null);
});
