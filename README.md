# Bayesian Reaction Optimization GUI

This browser tool suggests experiments for a fixed substrate pair while varying catalyst, base, solvent, and wavelength. The default target is a yield of at least 80%.

## Use

1. Enter the available catalyst, base, solvent, and wavelength candidates, one per line. Enter wavelengths in nm.
2. Set the target yield.
3. Select **Save search space**, then **Suggest next condition**.
4. Record the condition and measured yield, then request another suggestion.

Experiment data is stored in the browser's `localStorage`. It does not sync across browsers or devices. Use **Back up** to save a JSON copy regularly. CSV export is also available.

## Recommendation method

The first three recommendations spread experiments across the search space using category differences and wavelength distance. Later recommendations use a Gaussian process with a category mismatch correlation of 0.3 and an RBF kernel for wavelength. The tool selects the unmeasured condition with the highest expected improvement over the best observed yield. It does not infer chemical similarity between category names or use molecular descriptors. The target yield determines the achievement display and estimated probability of reaching the target. Predictions and probabilities are rough guides with small datasets, not calibrated confidence measures.

The model varies only these four parameters. Keep temperature, concentration, light intensity, reaction time, and other conditions fixed unless they are added as search parameters in a later version. An experimenter should assess each proposed condition for feasibility and safety.

## GitHub Pages

This is a dependency-free static site. The site files (`index.html`, `style.css`, `app.js`, and `optimizer.js`) are in the repository root. In the repository's **Settings → Pages**, select **Deploy from a branch**, then `main` and `/(root)`. The site will be available at `https://eiji-g.github.io/reaction-condition-bo/` once GitHub finishes publishing it.

Browser storage is specific to the site's address. Results entered on the previous hosting site will not appear on GitHub Pages automatically. Use **Back up** on the previous site and **Restore** on the new site to move them. Never commit exported experiment data to this repository.

## Development

Serve the repository root with any static server. Run tests with `node --test`.
