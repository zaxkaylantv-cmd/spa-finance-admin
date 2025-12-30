function buildLocalFileRef(multerFile) {
  if (!multerFile || !multerFile.filename) return null;
  return `local:uploads/${multerFile.filename}`;
}

module.exports = {
  buildLocalFileRef,
};
