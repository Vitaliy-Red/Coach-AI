// Не отдаём наружу служебные файлы (исходники функций, документацию, README),
// даже если папка сайта совпадает с корнем репозитория.
const BLOCKED = [/^\/(functions|docs|tests)(\/|$)/i, /^\/readme\.md$/i, /^\/\.git/i];

export async function onRequest({ request, next }) {
  const { pathname } = new URL(request.url);
  if (BLOCKED.some((re) => re.test(pathname))) {
    return new Response('Not found', { status: 404 });
  }
  return next();
}
