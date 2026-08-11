---
title: "nbre aléatire sur 6 colonnes"
description: "<?php // tableau.php header('Content-Type: text/html; charset=utf-8'); ?> <!DOCTYPE html>"
date: 2025-11-07
year: 2025
category: "Le club de Fouesnant"
joomlaId: 500
hits: 0
---

<?php
// tableau.php
header('Content-Type: text/html; charset=utf-8');
?>
<!DOCTYPE html>

Tableau 6×16 aléatoire (bordures grasses sans CSS)

Tableau 6 colonnes × 16 lignes – nombres aléatoires 1 à 99

<table border="6" cellpadding="10" cellspacing="0" bgcolor="#f0f0f0">
<tr bgcolor="#d0d0d0">
<th><b>Col 1</b></th>
<th><b>Col 2</b></th>
<th><b>Col 3</b></th>
<th><b>Col 4</b></th>
<th><b>Col 5</b></th>
<th><b>Col 6</b></th>
</tr>

<?php
// Génération des 16 lignes de données
for ($ligne = 1; $ligne <= 16; $ligne++) {
echo " <tr align=\\"center\\">\\n";
for ($col = 1; $col <= 6; $col++) {
$nombre = mt\_rand(1, 99); // nombre aléatoire entre 1 et 99
echo " <td><b>$nombre</b></td>\\n";
}
echo " </tr>\\n";
}
?>
</table>

<br>
Actualiser la page (F5) pour obtenir de nouveaux nombres aléatoires.
