'use strict';
/* Photo render: turns a snapshot of the planner's 3D view into a photorealistic image with OpenAI's image model.
   The prompt is built here from a few validated fields, never taken from the client as free text. */

const STYLES = {
  scandi: 'Scandinavian: light oak, linen and wool in oatmeal and soft grey, white ceiling, calm and airy',
  modern: 'modern: graphite and walnut, low clean-lined furniture, matte black metal details, restrained palette',
  loft: 'industrial loft: dark wood, cognac leather, black steel, warm low light'
};
const ROOM_NAMES = { living: 'living room', bedroom: 'bedroom', kitchen: 'kitchen', bathroom: 'bathroom', dining: 'dining room', office: 'home office', hall: 'hallway' };
const SIZES = { landscape: '1536x1024', portrait: '1024x1536', square: '1024x1024' };
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

class RenderError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

/* Checks and normalises the request body. Throws RenderError(400) with a message safe to show. */
function validate(body) {
  if (!body || typeof body !== 'object') throw new RenderError(400, 'bad_request', 'Send a JSON object.');
  const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(typeof body.image === 'string' ? body.image : '');
  if (!m) throw new RenderError(400, 'bad_image', 'The snapshot must be a PNG, JPEG or WebP data URL.');
  const bytes = Buffer.from(m[2], 'base64');
  if (bytes.length < 1000) throw new RenderError(400, 'bad_image', 'The snapshot is empty.');
  if (bytes.length > MAX_IMAGE_BYTES) throw new RenderError(413, 'image_too_large', 'The snapshot is larger than 5 MB.');
  if (!STYLES[body.style]) throw new RenderError(400, 'bad_style', 'Unknown style.');
  const view = body.view === 'orbit' ? 'orbit' : 'walk';
  const shape = SIZES[body.shape] ? body.shape : 'landscape';
  const rooms = (Array.isArray(body.rooms) ? body.rooms : []).slice(0, 12).map(r => ({
    type: ROOM_NAMES[r && r.type] ? r.type : null,
    wall: /^#[0-9a-f]{6}$/i.test(r && r.wall || '') ? r.wall.toUpperCase() : null,
    items: (Array.isArray(r && r.items) ? r.items : []).filter(s => typeof s === 'string' && /^[A-Za-z][A-Za-z ,-]{1,39}$/.test(s)).slice(0, 14)
  })).filter(r => r.type);
  if (!rooms.length) throw new RenderError(400, 'bad_rooms', 'Say which room is in the snapshot.');
  return { mime: 'image/' + m[1], bytes, style: body.style, view, shape, rooms };
}

function buildPrompt(input) {
  const what = input.view === 'orbit'
    ? 'a home seen from above as a cutaway model, with its ' + input.rooms.map(r => ROOM_NAMES[r.type]).join(', ')
    : 'a ' + ROOM_NAMES[input.rooms[0].type];
  const lines = [
    'Turn this simple 3D blockout of ' + what + ' into a photorealistic interior ' + (input.view === 'orbit' ? 'visualization' : 'photograph') + '.',
    'Keep exactly the same camera angle, room shape, walls, doors, windows and furniture layout. Every piece stays where it is, at the same size and proportions. Add no furniture, decor or plants that are not in the blockout, and remove nothing. No people, no text, no logos.',
    'Style: ' + STYLES[input.style] + '.'
  ];
  input.rooms.forEach(r => {
    const bits = [];
    if (r.wall) bits.push('walls painted ' + r.wall);
    if (r.items.length) bits.push('contains ' + r.items.join(', ').toLowerCase());
    if (bits.length) lines.push('The ' + ROOM_NAMES[r.type] + ': ' + bits.join('; ') + '.');
  });
  lines.push('Real materials and textures, soft natural daylight, gentle shadows, professional real estate photography, sharp and detailed.');
  return lines.join(' ');
}

/* Calls the image model. `env` supplies OPENAI_API_KEY and optional OPENAI_IMAGE_MODEL, OPENAI_IMAGE_QUALITY, OPENAI_BASE_URL.
   Resolves {image: dataURL, model}. */
async function renderImage(input, env, fetchImpl) {
  const key = env.OPENAI_API_KEY;
  if (!key) throw new RenderError(503, 'not_configured', 'Photo render is not set up on this server yet.');
  const model = env.OPENAI_IMAGE_MODEL || 'gpt-image-1';
  const form = new FormData();
  form.append('model', model);
  form.append('prompt', buildPrompt(input));
  form.append('size', SIZES[input.shape]);
  form.append('quality', env.OPENAI_IMAGE_QUALITY || 'medium');
  form.append('n', '1');
  form.append('image', new Blob([input.bytes], { type: input.mime }), 'blockout.' + input.mime.split('/')[1]);
  let res;
  try {
    res = await (fetchImpl || fetch)((env.OPENAI_BASE_URL || 'https://api.openai.com/v1') + '/images/edits', {
      method: 'POST', headers: { Authorization: 'Bearer ' + key }, body: form, signal: AbortSignal.timeout(180000)
    });
  } catch (e) { throw new RenderError(502, 'upstream_unreachable', 'The image service did not answer. Try again in a minute.'); }
  let data = null; try { data = await res.json(); } catch (e) {}
  if (!res.ok) {
    /* The upstream message can name the account or key, so only its status decides what the visitor is told. */
    console.error('[render] upstream', res.status, data && data.error && data.error.message);
    if (res.status === 429) throw new RenderError(429, 'upstream_busy', 'The image service is busy. Try again in a minute.');
    if (res.status === 400) throw new RenderError(422, 'rejected', 'The image service could not use this snapshot.');
    throw new RenderError(502, 'upstream_error', 'The image service returned an error.');
  }
  const b64 = data && data.data && data.data[0] && data.data[0].b64_json;
  if (!b64) throw new RenderError(502, 'upstream_empty', 'The image service returned no picture.');
  return { image: 'data:image/png;base64,' + b64, model };
}

module.exports = { validate, buildPrompt, renderImage, RenderError, STYLES, SIZES };
