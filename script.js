
// Constants
const Es = 2.04e6; // Steel Modulus (kgf/cm^2)
const epsilon_cu = 0.003; // Concrete ultimate strain

// Chart instance
let pmChart = null;

document.addEventListener('DOMContentLoaded', () => {
    // Initial Calculation
    calculateAndDraw();

    // Event Listeners for all inputs
    const inputs = document.querySelectorAll('input, select');
    inputs.forEach(input => {
        input.addEventListener('change', calculateAndDraw);
        input.addEventListener('input', calculateAndDraw); // Real-time update
    });
    
    document.getElementById('calcBtn').addEventListener('click', calculateAndDraw);
});

function calculateAndDraw() {
    // 1. Get Inputs
    const fc = parseFloat(document.getElementById('fc').value);
    const fy = parseFloat(document.getElementById('fy').value);
    const b = parseFloat(document.getElementById('b').value);
    const h = parseFloat(document.getElementById('h').value);
    const cover = parseFloat(document.getElementById('cover').value);
    const barArea = parseFloat(document.getElementById('barSize').value);
    const nx = parseInt(document.getElementById('nx').value);
    const ny = parseInt(document.getElementById('ny').value);

    // Basic Validation
    if (isNaN(fc) || isNaN(fy) || isNaN(b) || isNaN(h) || isNaN(cover) || isNaN(nx) || isNaN(ny)) return;
    
    // 2. Define Steel Layers
    // Simplified model: 
    // Top Row: nx bars
    // Bottom Row: nx bars
    // Side Rows: (ny - 2) * 2 bars distributed vertically
    
    // Arrays of {y: distance_from_top, As: area}
    let steelLayers = [];

    // Top Layer
    steelLayers.push({ y: cover, As: nx * barArea });
    
    // Bottom Layer
    steelLayers.push({ y: h - cover, As: nx * barArea });

    // Side Layers
    if (ny > 2) {
        const sideBarsPerLayer = 2; // one on left, one on right
        const numSideLayers = ny - 2;
        const verticalSpacing = (h - 2 * cover) / (ny - 1);
        
        for (let i = 1; i <= numSideLayers; i++) {
            steelLayers.push({
                y: cover + i * verticalSpacing,
                As: sideBarsPerLayer * barArea
            });
        }
    }

    const Ag = b * h;
    const Ast = steelLayers.reduce((sum, layer) => sum + layer.As, 0);

    // 3. Calculate Beta1
    let beta1 = 0.85;
    if (fc > 280) {
        beta1 = 0.85 - 0.05 * (fc - 280) / 70;
        if (beta1 < 0.65) beta1 = 0.65;
    }

    // 4. Generate Interaction Points
    let points = [];

    // Point 1: Pure Compression (Po)
    // Formula: Po = 0.85*fc*(Ag - Ast) + fy*Ast
    const Po = (0.85 * fc * (Ag - Ast) + fy * Ast) / 1000; // tonf
    points.push({ x: 0, y: Po });

    // Sweep Neutral Axis Depth c
    // Range: From just below pure compression down to pure tension.
    // We can define c values relative to h.
    // c range: [huge, h, ..., 0, ...]
    
    // Let's use a dense set of c/h ratios
    const c_ratios = [
        2.0, 1.5, 1.2, 1.1, 1.0, 
        0.9, 0.8, 0.7, 0.6, 0.55, 0.5, 0.45, 0.4, 0.35, 0.3, 0.25, 0.2, 0.15, 0.1, 0.05
    ];

    let maxM = 0;

    c_ratios.forEach(ratio => {
        const c = ratio * h;
        const pt = calculatePoint(c, b, h, fc, fy, beta1, steelLayers, epsilon_cu);
        points.push(pt);
        if (pt.x > maxM) maxM = pt.x;
    });

    // Pure Tension (Pt)
    // Po_t = -fy * Ast
    const Pt = (-fy * Ast) / 1000;
    points.push({ x: 0, y: Pt });

    // Update UI Summary
    const Mo_approx = maxM; // Approximate
    document.getElementById('val-Po').textContent = `${Po.toFixed(1)} tonf`;
    document.getElementById('val-Mo').textContent = `${Mo_approx.toFixed(1)} tonf-m`;

    // 5. Draw Chart
    drawChart(points);
}

function calculatePoint(c, b, h, fc, fy, beta1, steelLayers, epsilon_cu) {
    let Pn = 0; // kgf
    let Mn = 0; // kgf-cm

    // Concrete Compression Block
    let a = beta1 * c;
    if (a > h) a = h; // Cap at full depth
    
    // Concrete Force
    // C_c acts at a/2 from top
    const C_c = 0.85 * fc * b * a;
    
    // Contribution to Moment from Concrete (about Geometric Centroid h/2)
    // Arm = (h/2) - (a/2)
    const M_c = C_c * (h / 2 - a / 2);

    Pn += C_c;
    Mn += M_c;

    // Steel Forces
    steelLayers.forEach(layer => {
        const d = layer.y; // Depth from top
        
        // Strain from similar triangles
        // epsilon_s / (c - d) = epsilon_cu / c
        const epsilon_s = epsilon_cu * (c - d) / c;
        
        // Stress
        let fs = Es * epsilon_s;
        if (fs > fy) fs = fy;
        if (fs < -fy) fs = -fy;
        
        // Force
        const F_s = fs * layer.As; // + is compression
        
        // Moment Arm = (h/2) - d
        // If d < h/2 (top bars), arm is positive. F_s is compression (+). Moment contribution +
        // If d > h/2 (bottom bars), arm is negative. F_s is likely tension (-). Moment contribution +
        const M_s = F_s * (h / 2 - d);

        Pn += F_s;
        Mn += M_s;
    });

    // Convert to tonf and tonf-m
    return {
        x: Mn / 100000, // kgf-cm -> tonf-m
        y: Pn / 1000    // kgf -> tonf
    };
}

function drawChart(dataPoints) {
    const ctx = document.getElementById('pmChart').getContext('2d');
    
    // Sort points by Pn (descending) to ensure line draws correctly? 
    // Actually the sweep order [large c -> small c] generally corresponds to [high P -> low P].
    // Let's ensure it's clean strictly descending Y might be better for the Fill but user wants a curve.
    // The current order is Po -> High P -> Low P -> Pt. This is correct for drawing the line.

    if (pmChart) {
        pmChart.destroy();
    }

    pmChart = new Chart(ctx, {
        type: 'scatter',
        data: {
            datasets: [{
                label: '標稱強度 (Pn-Mn)',
                data: dataPoints,
                borderColor: 'rgba(59, 130, 246, 1)', // Blue accent
                backgroundColor: 'rgba(59, 130, 246, 0.2)',
                borderWidth: 3,
                showLine: true,
                pointRadius: 3,
                pointHoverRadius: 6,
                fill: false,
                tension: 0.4 // Smooth curve
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return `P: ${context.parsed.y.toFixed(1)} tonf, M: ${context.parsed.x.toFixed(1)} tonf-m`;
                        }
                    },
                    backgroundColor: 'rgba(30, 30, 30, 0.9)',
                    titleColor: '#fff',
                    bodyColor: '#ccc',
                    borderColor: '#444',
                    borderWidth: 1
                },
                legend: {
                    display: false // Using custom legend/text
                },
                title: {
                    display: true,
                    text: 'RC 柱 P-M 交互影響曲線',
                    color: '#fff',
                    font: {
                        size: 18,
                        family: "'Microsoft JhengHei', 'Inter', sans-serif"
                    },
                    padding: {
                        bottom: 20
                    }
                }
            },
            scales: {
                x: {
                    type: 'linear',
                    position: 'bottom',
                    title: {
                        display: true,
                        text: '彎矩 Mn (tonf-m)',
                        color: '#aaa',
                        font: {
                            family: "'Microsoft JhengHei', sans-serif"
                        }
                    },
                    grid: {
                        color: '#333'
                    },
                    ticks: {
                        color: '#888'
                    }
                },
                y: {
                    title: {
                        display: true,
                        text: '軸力 Pn (tonf)',
                        color: '#aaa',
                        font: {
                            family: "'Microsoft JhengHei', sans-serif"
                        }
                    },
                    grid: {
                        color: '#333'
                    },
                    ticks: {
                        color: '#888'
                    }
                }
            },
            interaction: {
                mode: 'nearest',
                axis: 'x',
                intersect: false
            }
        }
    });
}
