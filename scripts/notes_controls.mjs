// Root verifier counterpart of Cloud's NotesList helpers. Never split/trim notes.
import { expect } from '../web/node_modules/@playwright/test/index.mjs';

const group = (page, name) => page.getByRole('group', {name, exact:true});
export async function notesOf(page, name = 'Your notes') {
  const g = group(page, name);
  await g.waitFor();
  return g.locator('textarea').evaluateAll(els => els.map(e => e.value));
}
export async function expectNotes(page, list, name = 'Your notes') {
  await group(page, name).waitFor();
  await expect.poll(() => notesOf(page, name)).toEqual(list);
}
export async function setNotes(page, list, name = 'Your notes') {
  if (!Array.isArray(list) || list.some(text => typeof text !== 'string'))
    throw new TypeError('Notes must be an array of exact strings');
  const g = group(page, name);
  await g.waitFor();
  while (await g.getByRole('button', {name:/^Remove note \d+$/}).count())
    await g.getByRole('button', {name:'Remove note 1', exact:true}).click();
  for (const [i, text] of list.entries()) {
    await g.getByRole('button', {name:'Add a note', exact:true}).click();
    await g.getByRole('textbox', {name:`Note ${i + 1}`, exact:true}).fill(text);
  }
  await expectNotes(page, list, name);
}
