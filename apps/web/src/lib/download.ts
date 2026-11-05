/**
 * Entrega um arquivo ao navegador sem tocar em URL: o conteudo vive so em um blob local, e o link
 * temporario e revogado logo em seguida. Nada do arquivo vai para storage do navegador nem para logs.
 */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.append(link);
  link.click();
  link.remove();
  // Revogar na mesma volta pode cancelar o download em alguns navegadores.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}
