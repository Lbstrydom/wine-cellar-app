/**
 * @fileoverview Shared dropdown population helpers for bottle form and modal.
 * Avoids circular dependency between form.js and modal.js.
 * @module bottles/dropdownHelpers
 */

import { getCountries, getRegionsForCountry, loadWineRegions } from '../config/wineRegions.js';

/**
 * Populate the country <select> from the canonical region data.
 * Preserves first ("Select country...") and last ("Other") options.
 */
export function populateCountryDropdown() {
  const select = document.getElementById('wine-country');
  if (!select) return;

  const otherOpt = select.querySelector('option[value="Other"]');

  // Remove dynamic country options (between "Select..." and "Other")
  while (select.options.length > 2) {
    select.remove(1);
  }

  for (const country of getCountries()) {
    const opt = document.createElement('option');
    opt.value = country;
    opt.textContent = country;
    select.insertBefore(opt, otherOpt);
  }
}

/**
 * Populate the region <select> based on selected country.
 * Preserves first ("Select region...") and last ("Other") options.
 * @param {string} country - Selected country name
 */
export function populateRegionDropdown(country) {
  const select = document.getElementById('wine-region');
  if (!select) return;

  const otherOpt = select.querySelector('option[value="Other"]');

  // Remove dynamic region options (between "Select..." and "Other")
  while (select.options.length > 2) {
    select.remove(1);
  }

  const regions = getRegionsForCountry(country);
  for (const region of regions) {
    const opt = document.createElement('option');
    opt.value = region;
    opt.textContent = region;
    select.insertBefore(opt, otherOpt);
  }

  // Reset selection
  select.value = '';
  const otherInput = document.getElementById('wine-region-other');
  if (otherInput) {
    otherInput.style.display = 'none';
    otherInput.value = '';
  }
}

/**
 * Set country and region dropdowns to match a wine's values.
 * Handles known values (select from dropdown) and unknown values ("Other" + text input).
 * @param {Object} wine - Wine object with country and region fields
 */
export function setCountryRegionValues(wine) {
  const countrySelect = document.getElementById('wine-country');
  const countryOther = document.getElementById('wine-country-other');
  const regionSelect = document.getElementById('wine-region');
  const regionOther = document.getElementById('wine-region-other');

  // Set country
  if (wine.country && getCountries().includes(wine.country)) {
    countrySelect.value = wine.country;
    if (countryOther) countryOther.style.display = 'none';
  } else if (wine.country) {
    countrySelect.value = 'Other';
    if (countryOther) {
      countryOther.value = wine.country;
      countryOther.style.display = 'block';
    }
  } else {
    countrySelect.value = '';
    if (countryOther) countryOther.style.display = 'none';
  }

  // Populate region dropdown for this country
  populateRegionDropdown(wine.country || '');

  // Set region
  if (!regionSelect) return;

  const regions = getRegionsForCountry(wine.country);
  if (wine.region && regions.includes(wine.region)) {
    regionSelect.value = wine.region;
    if (regionOther) regionOther.style.display = 'none';
  } else if (wine.region) {
    regionSelect.value = 'Other';
    if (regionOther) {
      regionOther.value = wine.region;
      regionOther.style.display = 'block';
    }
  } else {
    regionSelect.value = '';
    if (regionOther) regionOther.style.display = 'none';
  }
}
