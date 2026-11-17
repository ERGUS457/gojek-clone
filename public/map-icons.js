// Custom Leaflet Icons for Gojek Clone
function createCustomMarkerIcon(type, heading = 0) {
  let svgContent = '';
  let bgClass = 'bg-[#00AA13]';
  let size = [36, 36];
  let anchor = [18, 18];

  if (type === 'goride') {
    // Motorcycle icon
    svgContent = `
      <div class="relative flex items-center justify-center w-10 h-10 rounded-full bg-[#00AA13] text-white shadow-lg border-2 border-white transition-transform duration-500 hover:scale-110">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <circle cx="5.5" cy="17.5" r="3.5" stroke-width="2"/>
          <circle cx="18.5" cy="17.5" r="3.5" stroke-width="2"/>
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 6h-3l-2.5 5.5H5.5M15 6l2 4h4M9.5 11.5l2-5.5h3.5"/>
        </svg>
      </div>
    `;
    size = [40, 40];
    anchor = [20, 20];
  } else if (type === 'gocar') {
    // Car icon
    svgContent = `
      <div class="relative flex items-center justify-center w-10 h-10 rounded-full bg-[#00AA13] text-white shadow-lg border-2 border-white transition-transform duration-500 hover:scale-110">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" />
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" />
        </svg>
      </div>
    `;
    size = [40, 40];
    anchor = [20, 20];
  } else if (type === 'pickup') {
    svgContent = `
      <div class="flex flex-col items-center">
        <div class="px-2 py-0.5 bg-black text-white text-[10px] font-bold rounded shadow-md whitespace-nowrap mb-1">Jemput</div>
        <div class="w-7 h-7 rounded-full bg-[#00AA13] border-4 border-white shadow-xl flex items-center justify-center">
          <div class="w-2 h-2 rounded-full bg-white"></div>
        </div>
      </div>
    `;
    size = [50, 50];
    anchor = [25, 45];
  } else if (type === 'dropoff') {
    svgContent = `
      <div class="flex flex-col items-center">
        <div class="px-2 py-0.5 bg-[#EE2737] text-white text-[10px] font-bold rounded shadow-md whitespace-nowrap mb-1">Tujuan</div>
        <div class="w-7 h-7 rounded-full bg-[#EE2737] border-4 border-white shadow-xl flex items-center justify-center">
          <div class="w-2 h-2 rounded-full bg-white"></div>
        </div>
      </div>
    `;
    size = [50, 50];
    anchor = [25, 45];
  }

  return L.divIcon({
    html: svgContent,
    className: 'custom-leaflet-marker',
    iconSize: size,
    iconAnchor: anchor
  });
}

window.createCustomMarkerIcon = createCustomMarkerIcon;
