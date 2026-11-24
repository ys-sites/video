function mountStoryboard(root) {
  const grid = root.querySelector('.om-storyboard-grid');
  const detail = root.querySelector('.om-storyboard-detail');
  const detailImage = detail.querySelector('img');
  const back = detail.querySelector('button');
  let selectedCover;

  for (const cover of grid.querySelectorAll('.om-storyboard-cover')) {
    cover.addEventListener('click', () => {
      const image = cover.querySelector('img');
      const caption = cover.nextElementSibling;
      selectedCover = cover;
      detailImage.src = image.src;
      detailImage.alt = image.alt;
      for (const field of ['meta', 'title', 'note']) {
        const selector = '.om-storyboard-' + field;
        detail.querySelector(selector).textContent = caption.querySelector(selector).textContent;
      }
      grid.hidden = true;
      detail.hidden = false;
      back.focus();
    });
  }

  function close() {
    detail.hidden = true;
    detailImage.removeAttribute('src');
    grid.hidden = false;
    selectedCover.focus();
  }

  back.addEventListener('click', close);
  detail.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  });
}
