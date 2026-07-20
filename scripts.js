const API_BASE = window.location.origin + "/api";
        let diccionarioEjercicios = {}; 
        let miGraficaDeLineas = null;
        let miGraficaTendencia = null; // Control para la gráfica global
        // Variable global para saber qué estamos haciendo
        let ejercicioActivoID = null;
        let grupoActivoNombre = null;
        let ejerciciosGlobales = []; // Guardaremos todo el catálogo aquí
        // --- VARIABLES DE ESTADO DEL ASISTENTE DE ENTRENAMIENTO ---
        let sesionActivaID = null;         // Guardará el ID único de la sesión de hoy
        let ejerciciosDeLaSesion = [];     // Lista de ejercicios elegidos para hoy
        let indiceEjercicioActual = 0;     // En qué ejercicio de la lista vamos
        let historialCargasAnteriores = {}; // Para comparar si subiste o bajaste pesos
        let modoConsulta = false;
        let graficaConsultaObj = null;
        // Estructura mejorada para acumular múltiples ejercicios de forma limpia
        let resumenSesion = {
            total_series: 0,
            ejercicios: {} // Almacenará { id_ejercicio: { nombre, grupo, series, max_peso, delta } }
        };
        let ejerciciosPlantillaCalendario = []; // Guardará la receta del día seleccionado  
        // 1. Descargar el catálogo a la memoria global sin dibujar la vista antigua
        async function cargarEjerciciosAgrupados() {
            try {
                const res = await fetch(`${API_BASE}/ejercicios`);
                ejerciciosGlobales = await res.json();
                // Ya no llamamos a dibujarTarjetasGrupos() porque el asistente tiene su propia vista
            } catch (e) { console.error("Error catálogo:", e); }
        }

        // 3. Viajar a la Selección Manual (Si no hay rutina sugerida)
        function seleccionarGrupo(grupoNombre) {
            grupoActivoNombre = grupoNombre;
            
            // ESCUDO: Prevenimos que ejercicios sin músculo (null) rompan el filtro
            const ejerciciosDelGrupo = ejerciciosGlobales.filter(ej => (ej.grupo_muscular || "").startsWith(grupoNombre));
            
            document.getElementById("titulo-grupo-seleccionado").innerText = `Elige tu ejercicio de ${grupoNombre}`;
            const contenedor = document.getElementById("contenedor-tarjetas-ejercicios");
            contenedor.innerHTML = "";
            
            ejerciciosDelGrupo.forEach(ej => {
                contenedor.innerHTML += `
                    <div class="tarjeta-seleccion" style="width: 100%; flex-direction: row; justify-content: flex-start; padding: 15px;" onclick="iniciarEjercicioManual(${ej.id}, '${ej.nombre}')">
                        <div class="tarjeta-titulo" style="text-align: left;">${ej.nombre} <br><small style="color: #666; font-weight: normal;">${ej.grupo_muscular || "General"}</small></div>
                    </div>
                `;
            });

            // MAGIA DINÁMICA: Ocultamos el botón rojo si estamos en modo Consulta
            const btnTerminarLista = document.getElementById("btn-terminar-sesion-lista");
            if (btnTerminarLista) {
                btnTerminarLista.style.display = modoConsulta ? "none" : "block";
            }

            document.getElementById("vista-pregunta-musculo").style.display = "none";
            document.getElementById("vista-lista-ejercicios").style.display = "flex";
        }

        // 4. Iniciar el Asistente con el ejercicio manual
        function iniciarEjercicioManual(id, nombre) {
            ejercicioActivoID = id;
            
            // CORRECCIÓN: Apagamos TODAS las pantallas previas para limpiar la vista
            document.getElementById("vista-lista-ejercicios").style.display = "none";
            document.getElementById("vista-pregunta-musculo").style.display = "none";

            if(modoConsulta) {
                // RUTA A: Solo dibujamos la gráfica en frío
                document.getElementById("titulo-consulta-ejercicio").innerText = `Análisis de: ${nombre}`;
                document.getElementById("vista-consulta-grafica").style.display = "flex";
                dibujarGraficaConsultaAislada();
            } else {
                // RUTA B: Asistente de Entrenamiento
                ejerciciosDeLaSesion = [{ id: id, nombre: nombre }];
                indiceEjercicioActual = 0;
                lanzarAsistenteEjercicio();
            }
        }

        // Botones de retroceso
        function volverAGrupos() {
            document.getElementById("vista-lista-ejercicios").style.display = "none";
            // CORREGIDO: Ahora apunta al ID correcto del nuevo diseño
            document.getElementById("vista-pregunta-musculo").style.display = "flex";
        }

        function volverAEjercicios() {
            document.getElementById("vista-tracking-ejercicio").style.display = "none";
            document.getElementById("vista-lista-ejercicios").style.display = "flex";
        }
        // Usamos DOMContentLoaded para que la interfaz se dibuje INSTANTÁNEAMENTE
        document.addEventListener('DOMContentLoaded', function() {
            const tokenSeguro = localStorage.getItem("gymlytics_token"); 
            
            if (tokenSeguro) {
                document.getElementById("login-caja").style.display = "none";
                document.getElementById("pantalla-carga").style.display = "block";
                iniciarDashboard(); 
            } else {
                mostrarPantallaLogin(); 
            }
        });

        // 2. FUNCIONES DE ACCESO
        function mostrarPantallaLogin() {
            document.getElementById("dashboard-principal").style.display = "none";
            document.getElementById("login-caja").style.display = "flex"; // <-- ¡AQUÍ ESTABA EL ERROR!
        }
        function cerrarSesion() {
            // BORRAMOS LAS LLAVES DE SEGURIDAD
            localStorage.removeItem("gymlytics_token"); 
            localStorage.removeItem("gymlytics_nombre");
            window.location.href = "/"; 
        }

        // 3. CARGA DEL ENTORNO DE TRABAJO (Solo ocurre si hay login)
        async function iniciarDashboard() {
            document.getElementById("login-caja").style.display = "none";
            const usr_id = obtenerUsuarioActivo();

            if (!usr_id) return;

            try {
                const res = await fetch(`${API_BASE}/biometria/estado/${usr_id}`);
                if (!res.ok) {
                    document.getElementById("pantalla-carga").style.display = "none"; // <-- APAGAR CARGA
                    document.getElementById("dashboard-principal").style.display = "none";
                    document.getElementById("pantalla-biometria").style.display = "none";
                    document.getElementById("msj-biometria").innerText = "Error crítico de conexión con la base de datos.";
                    return; 
                }

                const estado = await res.json();
                
                document.getElementById("pantalla-carga").style.display = "none"; // <-- APAGAR CARGA

                if (estado.requiere_pesaje) {
                    document.getElementById("dashboard-principal").style.display = "none";
                    document.getElementById("pantalla-biometria").style.display = "block";
                    document.getElementById("msj-biometria").innerText = estado.mensaje;
                } else {
                    document.getElementById("pantalla-biometria").style.display = "none";
                    document.getElementById("dashboard-principal").style.display = "flex";
                    
                    const nombreUsr = localStorage.getItem("gymlytics_nombre") || "Atleta";
                    document.getElementById("bienvenida-usuario").innerText = "🦅 Hola, " + nombreUsr;
                    
                    await cargarEjerciciosAgrupados(); 
                    
                    document.getElementById("vista-lobby-entrenamiento").style.display = "flex";
                    cargarTendenciaGlobal(); 

                    // NUEVO: Cargar los macros que se habían guardado antes en el día
                    const macrosGuardados = localStorage.getItem('gymlytics_macros_hoy');
                    if (macrosGuardados) {
                        const macros = JSON.parse(macrosGuardados);
                        document.getElementById("input-cal").value = macros.cal;
                        document.getElementById("input-pro").value = macros.pro;
                        document.getElementById("input-car").value = macros.car;
                        document.getElementById("input-gra").value = macros.gra;
                    }
                }
            } catch (e) {
                document.getElementById("pantalla-carga").style.display = "none";
                
                // RED DE SEGURIDAD: Volvemos a encender el login y mostramos el error
                document.getElementById("login-caja").style.display = "flex"; // <-- CAMBIADO A FLEX
                document.getElementById("login-error").innerText = "❌ Error de conexión al cargar tu perfil. Por favor, vuelve a entrar.";
                
                // Borramos el token defectuoso para evitar bucles
                localStorage.removeItem("gymlytics_token");
                console.error("Error validando el estado de biometría:", e);
            }
        }

        function obtenerTokenActivo() {
            return localStorage.getItem("gymlytics_token");
        }

        // --- MAGIA JWT: Extraemos el ID directamente del token firmado ---
        function obtenerUsuarioActivo() {
            const token = obtenerTokenActivo();
            if (!token) return null;
            
            try {
                // Desciframos la parte media del token (Payload)
                const base64Url = token.split('.')[1];
                const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
                const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
                    return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
                }).join(''));
                
                const payload = JSON.parse(jsonPayload);
                
                // Verificamos si ya expiró (la fecha 'exp' viene en segundos)
                const tiempoActual = Math.floor(Date.now() / 1000);
                if (payload.exp && payload.exp < tiempoActual) {
                    console.log("La sesión ha expirado por tiempo.");
                    cerrarSesion(); // Lo sacamos automáticamente
                    return null;
                }
                
                // Devolvemos el ID de forma invisible para que el resto de tu app siga funcionando igual
                return payload.usuario_id; 
            } catch (e) {
                return null;
            }
        }

        // NUEVA FUNCIÓN: Guardar datos corporales y liberar el sistema
async function enviarBiometria() {
            const resDiv = document.getElementById("mensaje-bio");
            const usr_id = obtenerUsuarioActivo();
            const peso = parseFloat(document.getElementById("bio_peso").value);
            
            if (isNaN(peso)) {
                resDiv.innerHTML = "❌ El peso es obligatorio para continuar.";
                resDiv.className = "error";
                return;
            }

            const datos = {
                usuario_id: parseInt(usr_id),
                peso_corporal: peso,
                porcentaje_grasa: parseFloat(document.getElementById("bio_grasa").value) || null,
                perimetro_cintura: parseFloat(document.getElementById("bio_cintura").value) || null,
                perimetro_brazo_der: parseFloat(document.getElementById("bio_brazo_der").value) || null,
                perimetro_brazo_izq: parseFloat(document.getElementById("bio_brazo_izq").value) || null,
                perimetro_pierna_der: parseFloat(document.getElementById("bio_pierna_der").value) || null,
                perimetro_pierna_izq: parseFloat(document.getElementById("bio_pierna_izq").value) || null
            };

            try {
                const res = await fetch(`${API_BASE}/biometria/registrar`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(datos)
                });

                if (res.ok) {
                    resDiv.innerHTML = "✅ ¡Datos registrados! Desbloqueando...";
                    resDiv.className = "exito";
                    
                    setTimeout(() => {
                        document.getElementById("mensaje-bio").innerHTML = ""; 
                        iniciarDashboard();
                    }, 1500);
                } else {
                    resDiv.innerHTML = "❌ Error al guardar datos en el servidor.";
                    resDiv.className = "error";
                }
            } catch (e) {
                resDiv.innerHTML = "❌ Error de conexión.";
            }
        }
        
        function mostrarRegistro() {
            document.getElementById("vista-login").style.display = "none";
            document.getElementById("vista-registro").style.display = "flex"; // <-- CAMBIADO A FLEX
        }

        function mostrarLogin() {
            document.getElementById("vista-registro").style.display = "none";
            document.getElementById("vista-login").style.display = "flex"; // <-- CAMBIADO A FLEX
        }

        async function ejecutarRegistro() {
            const nombre = document.getElementById("reg_nombre").value;
            const correo = document.getElementById("reg_correo").value;
            const pass = document.getElementById("reg_pass").value;
            const meta = document.getElementById("reg_meta").value;
            const msjDiv = document.getElementById("registro-msj");
            const btn = document.getElementById("btn-registro");

            if(!nombre || !correo || !pass) {
                msjDiv.innerHTML = "❌ Llena todos los campos.";
                msjDiv.style.color = "#dc3545";
                return;
            }

            btn.disabled = true;
            btn.innerText = "Creando cuenta...";

            try {
                const res = await fetch(`${API_BASE}/registro`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ nombre: nombre, correo: correo, contrasena: pass, meta: meta })
                });

                if (res.ok) {
                    msjDiv.innerHTML = "✅ ¡Cuenta creada! Iniciando sesión...";
                    msjDiv.style.color = "#28a745";
                    
                    // Auto-login para cero fricción
                    document.getElementById("login_correo").value = correo;
                    document.getElementById("login_pass").value = pass;
                    setTimeout(ejecutarLogin, 1500);
                } else {
                    const data = await res.json();
                    msjDiv.innerHTML = "❌ " + (data.detail || "Error al registrar");
                    msjDiv.style.color = "#dc3545";
                    btn.disabled = false;
                    btn.innerText = "Registrar mi perfil";
                }
            } catch(e) {
                msjDiv.innerHTML = "❌ Error de conexión al servidor.";
                btn.disabled = false;
                btn.innerText = "Registrar mi perfil";
            }
        }

        async function ejecutarLogin() {
            const correo = document.getElementById("login_correo").value; // Ahora leemos el correo
            const pass = document.getElementById("login_pass").value;
            const btn = document.getElementById("btn-login");
            const errorDiv = document.getElementById("login-error");

            btn.disabled = true;
            btn.innerText = "Verificando...";
            errorDiv.innerText = "";

            try {
                const res = await fetch(`${API_BASE}/login`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ correo: correo, contrasena: pass }) // Enviamos correo al Backend
                });

                if (res.ok) {
                    const data = await res.json();
                    localStorage.setItem("gymlytics_token", data.token);
                    localStorage.setItem("gymlytics_nombre", data.nombre);
                    window.location.href = "/"; 
                } else {
                    errorDiv.innerText = "❌ Correo o contraseña incorrectos.";
                }
            } catch (e) {
                errorDiv.innerText = "❌ Error al conectar con el servidor.";
            } finally {
                btn.disabled = false;
                btn.innerText = "Entrar";
            }
        }

        async function cargarHistorialEnVivo() {
            const cuerpoTabla = document.getElementById("tabla-historial-cuerpo");
            const usr_id = obtenerUsuarioActivo(); 

            if (!usr_id || !ejercicioActivoID) return;

            try {
                const res = await fetch(`${API_BASE}/entrenamiento/historial/${usr_id}`);
                const series = await res.json();
                
                // CORREGIDO: Filtramos para mostrar solo el historial del ejercicio seleccionado
                const seriesFiltradas = series.filter(s => s.ejercicio_id === ejercicioActivoID);

                cuerpoTabla.innerHTML = ""; 
                if (seriesFiltradas.length === 0) {
                    cuerpoTabla.innerHTML = "<tr><td colspan='4' style='color:#888;'>Sin series registradas aún.</td></tr>";
                    return;
                }

                seriesFiltradas.reverse().forEach(serie => {
                    const fechaFormateada = new Date(serie.fecha).toLocaleString('es-MX', {
                        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
                    });

                    cuerpoTabla.innerHTML += `
                        <tr>
                            <td style="color: #666; font-size: 0.85rem; font-weight: 500;">${fechaFormateada}</td>
                            <td>Serie ${serie.numero_serie}</td>
                            <td>${serie.peso_kg} kg</td>
                            <td>${serie.repeticiones}</td>
                        </tr>
                    `;
                });
            } catch (e) { console.error("Error historial:", e); }
        }

        async function enviarSerie() {
            const resDiv = document.getElementById("mensaje");
            const inputSerie = document.getElementById("num_serie");
            const usr_id = obtenerUsuarioActivo();
            
            const btnGuardar = document.querySelector("button[onclick='enviarSerie()']");
            btnGuardar.disabled = true;
            btnGuardar.innerText = "⏳ Guardando...";
            resDiv.innerHTML = "";
            
            // CORREGIDO: Usa el ID global en vez del viejo select
            const datos = {
                usuario_id: parseInt(usr_id),
                ejercicio_id: ejercicioActivoID,
                numero_serie: parseInt(inputSerie.value),
                peso_kg: parseFloat(document.getElementById("peso").value),
                repeticiones: parseInt(document.getElementById("reps").value)
            };
            
            try {
                const res = await fetch(`${API_BASE}/entrenamiento/registrar-serie`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(datos)
                });
                const data = await res.json();
                
                if (!res.ok) { 
                    let mensajeError = data.detail;
                    if (Array.isArray(data.detail)) mensajeError = "Datos inválidos.";
                    resDiv.innerHTML = "❌ " + mensajeError; 
                    resDiv.className = "error"; 
                } else { 
                    resDiv.innerHTML = "✅ Serie guardada"; 
                    resDiv.className = "exito";
                    inputSerie.value = datos.numero_serie + 1;
                    cargarHistorialEnVivo();
                    actualizarSugerencia(); 
                    dibujarGrafica();
                    actualizarConteoSeriesDia(); 
                }
            } catch (e) { 
                resDiv.innerHTML = "❌ Error de conexión"; 
            } finally {
                btnGuardar.disabled = false;
                btnGuardar.innerText = "Guardar Serie";
            }
        }
        async function actualizarConteoSeriesDia() {
            const usr_id = obtenerUsuarioActivo();
            if (!usr_id) return;

            try {
                // Usamos la ruta que ya tenías programada en tu backend
                const res = await fetch(`${API_BASE}/entrenamiento/analisis/series-hoy/${usr_id}`);
                if (res.ok) {
                    const data = await res.json();
                    document.getElementById("contador-series-hoy").innerText = data.total_series_dia;
                }
            } catch (e) {
                console.error("Error al obtener el conteo de series:", e);
            }
        }

        async function obtenerPrediccion() {
            const usr_id = obtenerUsuarioActivo();
            const num_serie = document.getElementById("pred_num_serie").value; 
            
            if(!ejercicioActivoID) return;

            try {
                const res = await fetch(`${API_BASE}/entrenamiento/prediccion/${usr_id}/${ejercicioActivoID}/${num_serie}`);
                const data = await res.json();
                
                const resBox = document.getElementById("prediccion-resultado");
                resBox.style.display = "block";
                document.getElementById("pred-texto").innerText = data.recomendacion_algoritmo || "Aviso:";
                document.getElementById("pred-objetivo").innerText = data.objetivo_hoy || data.mensaje;
                
                if(data.puntaje_recuperacion) {
                    document.getElementById("pred-info").innerText = `Readiness: ${data.puntaje_recuperacion} | Serie: #${data.numero_serie}`;
                } else {
                    document.getElementById("pred-info").innerText = "";
                }
            } catch (e) {}
        }

        async function actualizarSugerencia() {
            const usr_id = obtenerUsuarioActivo();
            const num_serie = document.getElementById("num_serie").value;
            
            const divMeta = document.getElementById("meta-dinamica");
            const textoMeta = document.getElementById("meta-texto");

            if (!usr_id || !ejercicioActivoID || !num_serie) return;

            try {
                const res = await fetch(`${API_BASE}/entrenamiento/prediccion/${usr_id}/${ejercicioActivoID}/${num_serie}`);
                const data = await res.json();

                if (data.objetivo_hoy) {
                    divMeta.style.display = "block";
                    textoMeta.innerHTML = data.objetivo_hoy.replace(/\n/g, '<br>');
                } else {
                    divMeta.style.display = "none";
                }
            } catch (e) { divMeta.style.display = "none"; }
        }

        async function dibujarGrafica() {
            const usr_id = obtenerUsuarioActivo();
            
            if (!usr_id || !ejercicioActivoID) return;

            try {
                const res = await fetch(`${API_BASE}/entrenamiento/historial/${usr_id}`);
                const historialCompleto = await res.json();

                const datosFiltrados = historialCompleto.filter(
                    registro => registro.ejercicio_id === ejercicioActivoID && registro.numero_serie === 1
                );

                // 1. Ordenamos estrictamente por fecha (del más antiguo al más reciente)
                datosFiltrados.sort((a, b) => new Date(a.fecha) - new Date(b.fecha));

                // 2. Mapeamos los datos limpios
                const etiquetasX = datosFiltrados.map(r => new Date(r.fecha).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }));
                const datosY_Peso = datosFiltrados.map(r => r.peso_kg);
                const datosY_Reps = datosFiltrados.map(r => r.repeticiones);

                const ctx = document.getElementById('miCanvasGrafica').getContext('2d');

                if (miGraficaDeLineas) miGraficaDeLineas.destroy();
                miGraficaDeLineas = new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: etiquetasX,
                        datasets: [
                            {
                                label: 'Peso (kg)',
                                data: datosY_Peso,
                                yAxisID: 'y',
                                borderColor: '#1a73e8',
                                backgroundColor: '#1a73e8',
                                borderWidth: 3,
                                pointRadius: 5,
                                tension: 0.3
                            },
                            {
                                label: 'Reps',
                                data: datosY_Reps,
                                yAxisID: 'y1',
                                borderColor: '#34a853',
                                backgroundColor: '#34a853',
                                borderWidth: 3,
                                pointRadius: 5,
                                borderDash: [5, 5],
                                tension: 0.3
                            }
                        ]
                    },
                    options: {
                        responsive: true, maintainAspectRatio: false,
                        interaction: { mode: 'index', intersect: false },
                        scales: {
                            y: { type: 'linear', display: true, position: 'left', title: { display: true, text: 'Kilos' } },
                            y1: { type: 'linear', display: true, position: 'right', title: { display: true, text: 'Reps' }, grid: { drawOnChartArea: false }, min: 0 }
                        }
                    }
                });
            } catch (e) { console.error("Error dibujando la gráfica:", e); }
        }

        async function generarReporte() {
            const usr_id = obtenerUsuarioActivo();
            const panelInsights = document.getElementById("panel-insights");
            const textoInsight = document.getElementById("texto-insight");

            if (!usr_id || !ejercicioActivoID) return;

            try {
                textoInsight.innerHTML = "Analizando...";
                panelInsights.style.display = "block";

                const res = await fetch(`${API_BASE}/analisis/correlacion/${usr_id}/${ejercicioActivoID}`);
                const data = await res.json();

                if (data.error) {
                    textoInsight.innerHTML = `⚠️ ${data.error}`;
                } else {
                    textoInsight.innerHTML = `
                        <strong>📊 Datos de Recuperación:</strong><br>
                        ${data.desglose_numerico}
                        <hr style="border:0; border-top: 1px solid #c2e7d9; margin: 10px 0;">
                        <strong>🧠 Conclusión:</strong><br>
                        ${data.analisis_ia}
                    `;
                }
            } catch (e) { textoInsight.innerHTML = "❌ Error."; }
        }

        // 11. OBTENER REPORTE SEMANAL HOLÍSTICO Y GENERAR GRÁFICA
        async function obtenerReporteSemanal() {
            const usr_id = obtenerUsuarioActivo();
            const panelSemanal = document.getElementById("panel-semanal");
            const textoSemanal = document.getElementById("texto-semanal");

            if (!usr_id) return;

            try {
                textoSemanal.innerHTML = "Correlacionando volumen de entrenamiento, nutrición y descanso...";
                panelSemanal.style.display = "block";

                const res = await fetch(`${API_BASE}/analisis/semanal/${usr_id}`);
                const data = await res.json();

                if (data.error) {
                    textoSemanal.innerHTML = `⚠️ ${data.error}`;
                } else {
                    textoSemanal.innerHTML = data.analisis_semanal;
                }
            } catch (e) {
                textoSemanal.innerHTML = "❌ Error al conectar con el motor analítico.";
            }
        }

        async function cargarTendenciaGlobal() {
            const usr_id = obtenerUsuarioActivo();
            if (!usr_id) return;

            try {
                const res = await fetch(`${API_BASE}/biometria/historico/${usr_id}`);
                const data = await res.json();

                if (data.error) {
                    alert(data.error);
                    return;
                }

                const ctx = document.getElementById('graficaTendenciaGlobal').getContext('2d');
                if (miGraficaTendencia) miGraficaTendencia.destroy();

                miGraficaTendencia = new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: data.fechas,
                        datasets: [
                            {
                                label: 'Peso Corporal (kg)',
                                data: data.peso,
                                borderColor: '#1a73e8',
                                backgroundColor: '#1a73e8',
                                borderWidth: 3,
                                cubicInterpolationMode: 'monotone', 
                                tension: 0.4,
                                pointRadius: 4,
                                spanGaps: true 
                            },
                            {
                                label: 'Cintura (cm)',
                                data: data.cintura,
                                borderColor: '#34a853', // Verde
                                backgroundColor: '#34a853',
                                borderWidth: 3,
                                borderDash: [5, 5], 
                                cubicInterpolationMode: 'monotone',
                                tension: 0.4,
                                pointRadius: 4,
                                spanGaps: true 
                            },
                            // NUEVO: Agregamos el porcentaje de grasa
                            {
                                label: 'Grasa (%)',
                                data: data.grasa,
                                borderColor: '#fbbc04', // Amarillo/Naranja
                                backgroundColor: '#fbbc04',
                                borderWidth: 3,
                                borderDash: [2, 2], // Punteado diferente
                                cubicInterpolationMode: 'monotone',
                                tension: 0.4,
                                pointRadius: 4,
                                spanGaps: true
                            }
                        ]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        interaction: { mode: 'index', intersect: false },
                        scales: {
                            y: { 
                                display: true, 
                                title: { display: true, text: 'Métricas' },
                                grid: { color: '#e0e0e0' } // Cuadrícula clara
                            },
                            x: { 
                                grid: { display: false } 
                            }
                        }
                    }
                });
            } catch (e) { console.error("Error cargando tendencia global:", e); }
        }
        // 1. Iniciar Flujo o Continuar Sesión Activa
        function comenzarEntrenamiento() {
            document.getElementById("tarjeta-recuperacion").style.display = "none";
            document.getElementById("tarjeta-nutricion").style.display = "none";
            document.getElementById("tarjeta-veredicto").style.display = "none";
            document.getElementById("tarjeta-grafica").style.display = "none";

            // ESCUDO DE MEMORIA: Solo creamos una nueva sesión si no hay una activa
            if (!sesionActivaID) {
                sesionActivaID = "SES-" + Date.now();
                resumenSesion = { total_series: 0, ejercicios: {}, series_detalle: [] };
            }
            
            // Limpiamos la plantilla temporal por si el usuario elige un ejercicio nuevo
            ejerciciosDeLaSesion = [];
            indiceEjercicioActual = 0;

            document.getElementById("vista-lobby-entrenamiento").style.display = "none";
            document.getElementById("vista-pregunta-musculo").style.display = "flex";
            
            dibujarBotonesMusculosWizard();
        }

        function dibujarBotonesMusculosWizard() {
            // LIMPIEZA: Reseteamos la barra y las vistas al entrar
            const buscador = document.getElementById("buscador-global");
            if(buscador) buscador.value = "";
            document.getElementById("contenedor-botones-musculos").style.display = "flex";
            document.getElementById("contenedor-resultados-busqueda").style.display = "none";
            
            // MAGIA DINÁMICA: Cambiamos la UI dependiendo del modo
            const tituloMenu = document.getElementById("titulo-vista-musculos");
            const btnTerminarSesion = document.getElementById("btn-terminar-sesion-musculos");
            
            if (modoConsulta) {
                tituloMenu.innerText = "📊 ¿De qué ejercicio quieres ver tus gráficas?";
                btnTerminarSesion.style.display = "none"; // Ocultamos el botón rojo
            } else {
                tituloMenu.innerText = "🏋️ ¿Qué vas a entrenar hoy?";
                btnTerminarSesion.style.display = "block"; // Mostramos el botón rojo
            }

            const contenedor = document.getElementById("contenedor-botones-musculos");
            contenedor.innerHTML = "";
            
            const gruposUnicos = [...new Set(ejerciciosGlobales.map(ej => (ej.grupo_muscular || "General").split(" - ")[0]))];
            
            gruposUnicos.forEach(m => {
                contenedor.innerHTML += `<button onclick="evaluarUltimaRutina('${m}')" style="width: 45%; background: white; color: #333; border: 2px solid #e0e0e0; font-size: 0.9rem; padding: 15px; border-radius: 12px;">${m}</button>`;
            });
        }
        // 2. Preguntar al Backend si recuerda qué hicimos la última vez
        async function evaluarUltimaRutina(grupoMuscular) {
            grupoActivoNombre = grupoMuscular; 
            const usr_id = obtenerUsuarioActivo();
            
            document.getElementById("vista-pregunta-musculo").style.display = "none";
            if(modoConsulta) {
                seleccionarGrupo(grupoActivoNombre);
                return;
            }
            try {
                const res = await fetch(`${API_BASE}/entrenamiento/ultima-rutina/${usr_id}/${grupoMuscular}`);
                const data = await res.json();
                
                if(data.ejercicios && data.ejercicios.length > 0) {
                    document.getElementById("texto-sugerencia-rutina").innerText = `Para ${grupoMuscular}, tu último entrenamiento tuvo estos ejercicios de forma secuencial:`;
                    const listaDiv = document.getElementById("lista-ejercicios-sugeridos");
                    listaDiv.innerHTML = "";
                    
                    ejerciciosDeLaSesion = data.ejercicios; // Cargamos la plantilla directamente
                    
                    data.ejercicios.forEach(ej => {
                        listaDiv.innerHTML += `• <strong>${ej.nombre}</strong><br>`;
                    });
                    
                    document.getElementById("vista-decision-plantilla").style.display = "flex";
                } else {
                    // Si el backend responde vacío, saltamos directo al catálogo manual
                    rechazarYBuscarManualmente();
                }
            } catch(e) { rechazarYBuscarManualmente(); }
        }

        function aceptarRutinaSugerida() {
            document.getElementById("vista-decision-plantilla").style.display = "none";
            indiceEjercicioActual = 0;
            lanzarAsistenteEjercicio();
        }

        function rechazarYBuscarManualmente() {
            // ESCUDO: Verificamos que la caja exista antes de ocultarla
            const vistaPlantilla = document.getElementById("vista-decision-plantilla");
            if (vistaPlantilla) {
                vistaPlantilla.style.display = "none";
            }
            
            // Reutilizamos el catálogo filtrado que ya tenías programado
            seleccionarGrupo(grupoActivoNombre); 
        }

        // 2. DETECTAR EL EJERCICIO ACTIVO E INICIALIZAR EN BITÁCORA
        function lanzarAsistenteEjercicio() {
            const ejActual = ejerciciosDeLaSesion[indiceEjercicioActual];
            ejercicioActivoID = ejActual.id;
            
            document.getElementById("asistente-ejercicio-titulo").innerText = `🏋️ Ejercicio: ${ejActual.nombre}`;
            
            document.getElementById("num_serie").value = "1";
            document.getElementById("peso").value = "";
            document.getElementById("reps").value = "";
            document.getElementById("mensaje").innerHTML = ""; 
            
            document.getElementById("asistente-conteo-series").innerText = resumenSesion.total_series;
            document.getElementById("vista-asistente-tracking").style.display = "flex";
            
            // Si el ejercicio no existe en la bitácora de hoy, lo damos de alta
            if (!resumenSesion.ejercicios[ejercicioActivoID]) {
                resumenSesion.ejercicios[ejercicioActivoID] = {
                    nombre: ejActual.nombre,
                    grupo: grupoActivoNombre,
                    series: 0,
                    max_peso: 0,
                    delta: "Estable o Consolidado 📊"
                };
            }
            
            actualizarSugerencia();
            dibujarGrafica();
            dibujarTablaSesion();
        }

        // 3. REGISTRAR SERIE ACUMULANDO EN EL HISTORIAL TEMPORAL
        async function enviarSerieAsistente() {
            const resDiv = document.getElementById("mensaje");
            const inputSerie = document.getElementById("num_serie");
            const token = obtenerTokenActivo(); // <--- EXTRAEMOS LA LLAVE SEGURA
            
            // Leemos los valores crudos
            let pesoCapturado = parseFloat(document.getElementById("peso").value);
            const repsCapturadas = parseInt(document.getElementById("reps").value);
            const unidadElegida = document.getElementById("unidad-peso").value;

            if (isNaN(pesoCapturado) || isNaN(repsCapturadas)) {
                resDiv.innerHTML = "❌ Por favor llena los campos de peso y repeticiones.";
                return;
            }

            // ESCUDO DE CONVERSIÓN
            if (unidadElegida === "lbs") {
                pesoCapturado = parseFloat((pesoCapturado / 2.20462).toFixed(2));
            }

            const btnGuardar = document.querySelector("button[onclick='enviarSerieAsistente()']");
            btnGuardar.disabled = true;
            
            // ELIMINAMOS usuario_id del paquete JSON
            const datos = {
                ejercicio_id: ejercicioActivoID,
                sesion_id: sesionActivaID, 
                numero_serie: parseInt(inputSerie.value),
                peso_kg: pesoCapturado, 
                repeticiones: repsCapturadas
            };

            try {
                const res = await fetch(`${API_BASE}/entrenamiento/registrar-serie`, {
                    method: "POST",
                    headers: { 
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${token}` // <--- ENVIAMOS LA LLAVE AQUÍ
                    },
                    body: JSON.stringify(datos)
                });
                const data = await res.json();
                if (res.ok) { 
                    resDiv.innerHTML = "✅ Serie guardada con éxito"; 
                    resDiv.className = "exito";
                    
                    resumenSesion.total_series++;
                    
                    resumenSesion.ejercicios[ejercicioActivoID].series++;
                    if (pesoCapturado > resumenSesion.ejercicios[ejercicioActivoID].max_peso) {
                        resumenSesion.ejercicios[ejercicioActivoID].max_peso = pesoCapturado;
                    }
                    
                    document.getElementById("asistente-conteo-series").innerText = resumenSesion.total_series;
                    inputSerie.value = parseInt(inputSerie.value) + 1;
                    
                    // Guardamos el detalle en la memoria temporal
                    resumenSesion.series_detalle.push({
                        id_db: data.datos.id,
                        nombre_ejercicio: document.getElementById("asistente-ejercicio-titulo").innerText.replace("🏋️ Ejercicio: ", ""),
                        numero_serie: parseInt(inputSerie.value) - 1,
                        peso: pesoCapturado,
                        reps: repsCapturadas
                    });
                    
                    actualizarSugerencia(); 
                    dibujarGrafica(); 
                    dibujarTablaSesion(); // <-- Refrescamos la tabla
                } else {
                    const data = await res.json();
                    resDiv.innerHTML = "❌ " + (data.detail || "Error al registrar.");
                }
            } catch (e) { resDiv.innerHTML = "❌ Error de conexión."; }
            finally { btnGuardar.disabled = false; }
        }
        // 4. FLUJO DINÁMICO SIN ALERTAS MOLESTAS (Regresa a menús de elección)
        async function preguntarSiguientePaso() {
            // Evaluamos cargas contra la sesión pasada antes de apagar la pantalla
            await registrarProgresoCargaResumen();
            
            document.getElementById("vista-asistente-tracking").style.display = "none";
            
            indiceEjercicioActual++;
            if(indiceEjercicioActual < ejerciciosDeLaSesion.length) {
                // Sigue la secuencia automática si venía de una rutina sugerida completa
                lanzarAsistenteEjercicio();
            } else {
                // Si terminó un ejercicio manual o la plantilla concluyó, vuelve al selector.
                // Desde ahí el usuario decidirá si selecciona otro músculo o presiona "Terminar Sesión"
                document.getElementById("vista-pregunta-musculo").style.display = "flex";
            }
        }

        // Analiza el delta y lo guarda directamente en la tarjeta de ese ejercicio
        async function registrarProgresoCargaResumen() {
            const usr_id = obtenerUsuarioActivo();
            if (!usr_id || !ejercicioActivoID) return;
            try {
                const res = await fetch(`${API_BASE}/analisis/correlacion/${usr_id}/${ejercicioActivoID}`);
                if(res.ok) {
                    const data = await res.json();
                    if(data.estadisticas && resumenSesion.ejercicios[ejercicioActivoID]) {
                        const pDelta = data.estadisticas.peso_delta;
                        const rDelta = data.estadisticas.reps_delta;

                        // LÓGICA CORREGIDA: Sube peso, O mantiene peso y suben reps.
                        if (pDelta > 0 || (pDelta === 0 && rDelta > 0)) {
                            resumenSesion.ejercicios[ejercicioActivoID].delta = "Aumentó Carga 🔼";
                        } 
                        // Baja peso, O mantiene peso pero bajan reps.
                        else if (pDelta < 0 || (pDelta === 0 && rDelta < 0)) {
                            resumenSesion.ejercicios[ejercicioActivoID].delta = "Disminuyó Carga 🔽";
                        } 
                        // Mismo peso y mismas reps exactas
                        else {
                            resumenSesion.ejercicios[ejercicioActivoID].delta = "Estable o Consolidado 📊";
                        }
                    }
                }
            } catch(e){}
        }

        // 5. RENDERIZADO COMPLETO DEL RESUMEN HISTÓRICO DE LA SESIÓN
        function finalizarSesiónTotal() {
            document.getElementById("vista-asistente-tracking").style.display = "none";
            document.getElementById("vista-pregunta-musculo").style.display = "none";
            document.getElementById("vista-lista-ejercicios").style.display = "none";
            document.getElementById("vista-decision-plantilla").style.display = "none";
            
            document.getElementById("resumen-total-series").innerText = resumenSesion.total_series;
            
            const divMusculos = document.getElementById("resumen-desglose-musculos");
            const divCargas = document.getElementById("resumen-analisis-cargas");
            
            divMusculos.innerHTML = "";
            divCargas.innerHTML = "";
            
            const listaEjerciciosHechos = Object.values(resumenSesion.ejercicios);

            if(listaEjerciciosHechos.length === 0) {
                divMusculos.innerHTML = "No registraste series en esta sesión.";
                divCargas.innerHTML = "Sin datos de sobrecarga para evaluar hoy.";
                document.getElementById("vista-resumen-final").style.display = "flex";
                return;
            }
            
            // Recorremos la bitácora completa de los ejercicios entrenados hoy
            listaEjerciciosHechos.forEach(ej => {
                // Impresión detallada de series y peso máximo alcanzado
                divMusculos.innerHTML += `• <strong>${ej.nombre}</strong> (${ej.grupo}): <strong>${ej.series}</strong> series efectivas. Máx: <strong>${ej.max_peso} kg</strong>.<br>`;
                
                // Color dinámico según desempeño analítico
                let estiloColor = "color: #555;";
                if(ej.delta.includes("🔼")) estiloColor = "color: #2e7d32; font-weight: bold;";
                if(ej.delta.includes("🔽")) estiloColor = "color: #c62828; font-weight: bold;";
                
                divCargas.innerHTML += `• ${ej.nombre}: <span style="${estiloColor}">${ej.delta}</span><br>`;
            });

            document.getElementById("vista-resumen-final").style.display = "flex";
        }
        // --- MÓDULO CONSULTA ---
        function abrirConsulta() {
            modoConsulta = true;
            document.getElementById("vista-lobby-entrenamiento").style.display = "none";
            document.getElementById("tarjeta-recuperacion").style.display = "none";
            document.getElementById("tarjeta-nutricion").style.display = "none";
            document.getElementById("tarjeta-veredicto").style.display = "none";
            document.getElementById("tarjeta-grafica").style.display = "none";
            
            document.getElementById("vista-pregunta-musculo").style.display = "flex";
            dibujarBotonesMusculosWizard(); // Reutilizamos tu UI de músculos
        }

        function volverAEjerciciosConsulta() {
            document.getElementById("vista-consulta-grafica").style.display = "none";
            seleccionarGrupo(grupoActivoNombre);
        }

        // --- MÓDULO CALENDARIO ---
        function abrirCalendario() {
            document.getElementById("vista-lobby-entrenamiento").style.display = "none";
            document.getElementById("tarjeta-recuperacion").style.display = "none";
            document.getElementById("tarjeta-nutricion").style.display = "none";
            document.getElementById("tarjeta-veredicto").style.display = "none";
            document.getElementById("tarjeta-grafica").style.display = "none";
            
            document.getElementById("vista-calendario").style.display = "flex";
        }

        async function consultarDiaEspecifico() {
            const fechaElegida = document.getElementById("selector-fecha").value;
            if(!fechaElegida) return;
            
            const usr_id = obtenerUsuarioActivo();
            const divRes = document.getElementById("resultado-dia");
            divRes.innerHTML = "⏳ Extrayendo bitácora de la base de datos...";
            divRes.style.display = "block";

            try {
                const res = await fetch(`${API_BASE}/analisis/dia/${usr_id}/${fechaElegida}`);
                const data = await res.json();

                if(data.error) {
                    divRes.innerHTML = `❌ ${data.error}`;
                    return;
                }
                let html = `<h3 class="color-accent mt-0 text-shadow">Nutrición y Descanso</h3>
                            <p class="mt-5 mb-5 color-light">• Sueño: <strong class="color-white">${data.nutricion.sueno}</strong> h</p>
                            <p class="mt-5 mb-5 color-light">• Calorías: <strong class="color-white">${data.nutricion.calorias}</strong> kcal</p>
                            <p class="mt-5 mb-5 color-light">• Proteínas: <strong class="color-white">${data.nutricion.proteinas}</strong> g</p>
                            <p class="mt-5 mb-5 color-light">• Carbohidratos: <strong class="color-white">${data.nutricion.carbohidratos}</strong> g</p>
                            <p class="mt-5 mb-5 color-light">• Grasas: <strong class="color-white">${data.nutricion.grasas}</strong> g</p>
                            <hr>
                            <h3 class="color-accent mt-0 text-shadow">🏋️ Rendimiento Físico</h3>
                            <p class="mt-5 mb-5 color-light">Total de series: <strong class="color-white">${data.entrenamiento.total_series}</strong></p>`;
                // Reiniciamos la plantilla temporal
                ejerciciosPlantillaCalendario = [];

                if(data.entrenamiento.total_series > 0) {
                    html += `<ul style="padding-left:20px; font-size:0.9rem; color:#444; margin-bottom:15px;">`;
                    
                    for (const [ejNombre, stats] of Object.entries(data.entrenamiento.desglose)) {
                        html += `<li style="margin-bottom:5px;"><strong>${ejNombre}</strong>: ${stats.series} series (Máx: ${stats.max_peso}kg)</li>`;
                        
                        // Guardamos la receta en orden
                        ejerciciosPlantillaCalendario.push({ id: stats.id, nombre: ejNombre });
                    }
                    html += `</ul>`;
                    
                    // NUEVO: Botón dinámico para clonar el entrenamiento entero de ese día
                    html += `<button onclick="cargarEntrenamientoDesdeCalendario()" style="background-color: #39ff14; color: #000; color: white; font-weight: bold; padding: 12px; border-radius: 8px; width: 100%;">🏋️ Repetir este Entrenamiento</button>`;
                } else {
                    html += `<p style="color:#666; font-style:italic;">Día de descanso activo o sin registros deportivos.</p>`;
                }

                divRes.innerHTML = html;
            } catch(e) { divRes.innerHTML = "❌ Error al conectar con Neon.tech."; }
        }

        // --- CLON DE GRÁFICA PARA CONSULTA AISLADA ---
        async function dibujarGraficaConsultaAislada() {
            const usr_id = obtenerUsuarioActivo();
            if (!usr_id || !ejercicioActivoID) return;

            try {
                const res = await fetch(`${API_BASE}/entrenamiento/historial/${usr_id}`);
                const historialCompleto = await res.json();

                const datosFiltrados = historialCompleto.filter(
                    registro => registro.ejercicio_id === ejercicioActivoID && registro.numero_serie === 1
                );

                // 1. Ordenamos estrictamente por fecha (del más antiguo al más reciente)
                datosFiltrados.sort((a, b) => new Date(a.fecha) - new Date(b.fecha));

                // 2. Mapeamos los datos limpios
                const etiquetasX = datosFiltrados.map(r => new Date(r.fecha).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }));
                const datosY_Peso = datosFiltrados.map(r => r.peso_kg);
                const datosY_Reps = datosFiltrados.map(r => r.repeticiones);

                // ESTA ES LA VERSIÓN CORREGIDA:
                const ctx = document.getElementById('miCanvasConsulta').getContext('2d');
                if (graficaConsultaObj) graficaConsultaObj.destroy();
                
                graficaConsultaObj = new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: etiquetasX,
                        datasets: [
                            { label: 'Peso (kg)', data: datosY_Peso, yAxisID: 'y', borderColor: '#1a73e8', backgroundColor: '#1a73e8', borderWidth: 3, pointRadius: 5, tension: 0.3 },
                            { label: 'Reps', data: datosY_Reps, yAxisID: 'y1', borderColor: '#34a853', backgroundColor: '#34a853', borderWidth: 3, pointRadius: 5, borderDash: [5, 5], tension: 0.3 }
                        ]
                    },
                    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, scales: { y: { type: 'linear', display: true, position: 'left' }, y1: { type: 'linear', display: true, position: 'right', grid: { drawOnChartArea: false }, min: 0 } } }
                });
            } catch (e) { console.error("Error dibujando la gráfica aislada:", e); }
        }

        function volverAlLobby() {
            // 1. Apagamos todas las pantallas de los módulos
            document.getElementById("vista-pregunta-musculo").style.display = "none";
            document.getElementById("vista-lista-ejercicios").style.display = "none";
            document.getElementById("tarjeta-nutricion").style.display = "block";
            document.getElementById("vista-asistente-tracking").style.display = "none";
            document.getElementById("vista-decision-plantilla").style.display = "none";
            
            // 2. Apagamos la bandera de consulta
            modoConsulta = false;

            // 3. UX MAGIA: Si el usuario dejó un entrenamiento a medias, transformamos el botón
            const btnComenzar = document.querySelector("button[onclick='comenzarEntrenamiento()']");
            if (btnComenzar && sesionActivaID) {
                btnComenzar.innerHTML = "🔄 Continuar Entrenamiento";
                btnComenzar.style.backgroundColor = "#fbbc04"; // Color amarillo de "en progreso"
                btnComenzar.style.color = "#333";
            }

            // 4. Volvemos a encender el lobby y las tarjetas principales
            document.getElementById("vista-lobby-entrenamiento").style.display = "flex";
            document.getElementById("tarjeta-recuperacion").style.display = "block";
            document.getElementById("tarjeta-veredicto").style.display = "block";
            document.getElementById("tarjeta-grafica").style.display = "block";
        }
        function cargarEntrenamientoDesdeCalendario() {
            if(!ejerciciosPlantillaCalendario || ejerciciosPlantillaCalendario.length === 0) return;
            
            // 1. MODO ENFOQUE: Apagamos el calendario y las tarjetas principales
            document.getElementById("tarjeta-recuperacion").style.display = "none";
            document.getElementById("tarjeta-nutricion").style.display = "none";
            document.getElementById("tarjeta-veredicto").style.display = "none";
            document.getElementById("tarjeta-grafica").style.display = "none";
            document.getElementById("vista-calendario").style.display = "none";

            // 2. Inicializamos una nueva sesión con la receta copiada
            sesionActivaID = "SES-" + Date.now();
            resumenSesion = { total_series: 0, ejercicios: {}, series_detalle: [] };
            
            // Copiamos los ejercicios exactamente en el orden del calendario
            ejerciciosDeLaSesion = [...ejerciciosPlantillaCalendario];
            indiceEjercicioActual = 0;

            // 3. Lanzamos el asistente directo al primer ejercicio
            lanzarAsistenteEjercicio();
        }
        // --- MOTOR DE BÚSQUEDA GLOBAL ---
        function buscarEjercicioGlobal() {
            const textoBusqueda = document.getElementById("buscador-global").value.toLowerCase();
            const divMusculos = document.getElementById("contenedor-botones-musculos");
            const divResultados = document.getElementById("contenedor-resultados-busqueda");

            // Si la barra está vacía, regresamos a la vista de botones
            if (textoBusqueda.trim() === "") {
                divMusculos.style.display = "flex";
                divResultados.style.display = "none";
                divResultados.innerHTML = "";
                return;
            }

            // Si hay texto, ocultamos los botones de músculos y encendemos el buscador
            divMusculos.style.display = "none";
            divResultados.style.display = "flex";
            divResultados.innerHTML = "";

            // Filtramos todo el catálogo en memoria
            const filtrados = ejerciciosGlobales.filter(ej => ej.nombre.toLowerCase().includes(textoBusqueda));

            if (filtrados.length === 0) {
                divResultados.innerHTML = "<p style='color:#666; font-style:italic;'>No se encontraron ejercicios con ese nombre.</p>";
                return;
            }

            // Renderizamos las tarjetas directamente, usando la función inteligente que ya teníamos
            filtrados.forEach(ej => {
                divResultados.innerHTML += `
                    <div class="tarjeta-seleccion" style="width: 100%; flex-direction: row; justify-content: flex-start; padding: 15px;" onclick="iniciarEjercicioManual(${ej.id}, '${ej.nombre}')">
                        <div class="tarjeta-titulo" style="text-align: left;">${ej.nombre} <br><small style="color: #666; font-weight: normal;">${ej.grupo_muscular || "General"}</small></div>
                    </div>
                `;
            });
        }

function iniciarSesionGoogle() {

    const botonGoogle = document.querySelector(
        "#google-hidden-button div[role='button']"
    );

    if (botonGoogle) {

        botonGoogle.click();

    } else {

        console.error("El botón de Google todavía no está cargado.");

    }

}



async function manejarRespuestaGoogle(response) {
    // Token JWT entregado por Google
    const googleToken = response.credential;
    const errorDiv = document.getElementById("login-error");
    // Meta por defecto
    let metaElegida = "Hipertrofia";
    // Detectar si está en registro
    const vistaRegistro = document.getElementById("vista-registro");
    if (vistaRegistro && vistaRegistro.style.display === "block") {
        metaElegida = document.getElementById("reg_meta").value;
    }
    try {
        const res = await fetch(`${API_BASE}/auth/google`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                token: googleToken,
                meta: metaElegida
            })
        });
        if (res.ok) {
            const data = await res.json();
            localStorage.setItem(
                "gymlytics_token",
                data.token
            );
            localStorage.setItem(
                "gymlytics_nombre",
                data.nombre
            );
            window.location.href = "/";
        } else {
            errorDiv.innerText =
                "❌ Error al iniciar sesión con Google.";
        }
    } catch (e) {
        errorDiv.innerText =
            "❌ Error de conexión al servidor.";
        console.error(e);
    }
}
        function dibujarTablaSesion() {
            const cuerpoTabla = document.getElementById("tabla-sesion-actual-cuerpo");
            if (!cuerpoTabla) return;
            
            if (resumenSesion.series_detalle.length === 0) {
                cuerpoTabla.innerHTML = "<tr><td colspan='4' style='color:#888;'>No hay series registradas aún.</td></tr>";
                return;
            }
            
            cuerpoTabla.innerHTML = "";
            // Mostramos de la más reciente a la más antigua
            [...resumenSesion.series_detalle].reverse().forEach((s, indexReverso) => {
                const indexReal = resumenSesion.series_detalle.length - 1 - indexReverso;
                
                cuerpoTabla.innerHTML += `
                    <tr>
                        <td style="color: #39ff14; font-weight: bold;">${s.nombre_ejercicio}</td>
                        <td>#${s.numero_serie}</td>
                        <td>${s.peso} kg</td>
                        <td>${s.reps}</td>
                        <td>
                            <button onclick="editarSerie(${s.id_db}, ${indexReal}, ${s.peso}, ${s.reps})" style="background: transparent; border: none; font-size: 1rem; cursor: pointer;" title="Editar">✏️</button>
                            <button onclick="eliminarSerie(${s.id_db}, ${indexReal})" style="background: transparent; border: none; font-size: 1rem; cursor: pointer;" title="Eliminar">🗑️</button>
                        </td>
                    </tr>
                `;
            });
        }
        async function editarSerie(id_db, indexArray, pesoActual, repsActual) {
            // 1. Pedimos los nuevos datos mediante ventanas nativas ligeras
            const nuevoPesoStr = prompt("✏️ Editar Peso (kg):", pesoActual);
            if (nuevoPesoStr === null) return; // Si presiona "Cancelar", abortamos

            const nuevasRepsStr = prompt("✏️ Editar Repeticiones:", repsActual);
            if (nuevasRepsStr === null) return; 

            const nuevoPeso = parseFloat(nuevoPesoStr);
            const nuevasReps = parseInt(nuevasRepsStr);

            if (isNaN(nuevoPeso) || isNaN(nuevasReps)) {
                alert("❌ Por favor ingresa números válidos.");
                return;
            }

            // 2. Enviamos la orden de edición al servidor en Render
            const token = obtenerTokenActivo();
            try {
                const res = await fetch(`${API_BASE}/entrenamiento/serie/${id_db}`, {
                    method: "PUT",
                    headers: { 
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${token}`
                    },
                    body: JSON.stringify({ peso_kg: nuevoPeso, repeticiones: nuevasReps })
                });

                if (res.ok) {
                    // 3. Actualizamos la memoria temporal de la pantalla
                    resumenSesion.series_detalle[indexArray].peso = nuevoPeso;
                    resumenSesion.series_detalle[indexArray].reps = nuevasReps;
                    
                    // 4. Refrescamos la UI (Tabla y Gráfica) para ver el cambio al instante
                    dibujarTablaSesion();
                    dibujarGrafica();
                } else {
                    alert("❌ Error al guardar los cambios en el servidor.");
                }
            } catch(e) {
                alert("❌ Error de conexión al intentar editar.");
            }
        }
        async function eliminarSerie(id_db, indexArray) {
            // 1. Candado de seguridad para evitar accidentes
            const confirmar = confirm("⚠️ ¿Estás seguro de que deseas eliminar esta serie?");
            if (!confirmar) return;

            // 2. Enviamos la orden de eliminación al servidor
            const token = obtenerTokenActivo();
            try {
                const res = await fetch(`${API_BASE}/entrenamiento/serie/${id_db}`, {
                    method: "DELETE",
                    headers: { 
                        "Authorization": `Bearer ${token}`
                    }
                });

                if (res.ok) {
                    // 3. Borramos el dato de la memoria temporal del arreglo
                    resumenSesion.series_detalle.splice(indexArray, 1);
                    
                    // 4. Restamos la serie del contador global
                    resumenSesion.total_series--;
                    document.getElementById("asistente-conteo-series").innerText = resumenSesion.total_series;
                    
                    if (resumenSesion.ejercicios[ejercicioActivoID]) {
                        resumenSesion.ejercicios[ejercicioActivoID].series--;
                    }
                    
                    // 5. Refrescamos la UI (Tabla y Gráfica) para borrarlo de la pantalla
                    dibujarTablaSesion();
                    dibujarGrafica();
                } else {
                    alert("❌ Error al eliminar la serie en el servidor.");
                }
            } catch(e) {
                alert("❌ Error de conexión al intentar eliminar.");
            }
        }
        async function analizarComidaEnUI() {
            const input = document.getElementById("input-comida");
            const chat = document.getElementById("chat-historial");
            const btnEnviar = document.getElementById("btn-enviar-comida"); // <-- Nuevo
            const texto = input.value.trim();

            if (!texto) return;

            // BLOQUEO DE SEGURIDAD: Desactivamos el botón y el input
            input.disabled = true;
            if(btnEnviar) btnEnviar.disabled = true;

            // 1. Dibujar el mensaje del usuario (Burbuja verde)
            chat.innerHTML += `<div class="burbuja-user"><strong class="color-accent">Tú:</strong> ${texto}</div>`;
            input.value = "";
            
            // 2. Dibujar el indicador de "Escribiendo..."
            const idCarga = "carga-" + Date.now();
            chat.innerHTML += `<div id="${idCarga}" class="color-gray text-small"><em>🤖 Analizando datos...</em></div>`;
            chat.scrollTop = chat.scrollHeight;

            const token = obtenerTokenActivo();

            try {
                // ... (AQUÍ VA TU CÓDIGO FETCH EXACTAMENTE COMO ESTÁ) ...
                // 3. Enviar la petición a tu servidor en Render
                const res = await fetch(`${API_BASE}/nutricion/analizar`, {
                    method: "POST",
                    headers: { 
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${token}`
                    },
                    body: JSON.stringify({ texto_comida: texto })
                });

                // Borramos el "Escribiendo..."
                document.getElementById(idCarga).remove();
                    if (res.ok) {
                    const datos = await res.json();
                    
                    // 1. Dibujar la respuesta de la IA en el chat
                    const msgIA = `<div class="burbuja-ia"><strong class="color-accent">🤖 IA:</strong> ${datos.resumen}</div>`;
                    chat.innerHTML += msgIA;

                    // 2. EL SWITCH: Decidir qué hacer en la pantalla
                    if (datos.tipo === "comida") {
                        const calActual = parseFloat(document.getElementById("input-cal").value) || 0;
                        const proActual = parseFloat(document.getElementById("input-pro").value) || 0;
                        const carActual = parseFloat(document.getElementById("input-car").value) || 0;
                        const graActual = parseFloat(document.getElementById("input-gra").value) || 0;

                        const nuevasCal = Math.round(calActual + datos.calorias);
                        const nuevasPro = Math.round(proActual + datos.proteinas);
                        const nuevosCar = Math.round(carActual + datos.carbohidratos);
                        const nuevasGra = Math.round(graActual + datos.grasas);

                        document.getElementById("input-cal").value = nuevasCal;
                        document.getElementById("input-pro").value = nuevasPro;
                        document.getElementById("input-car").value = nuevosCar;
                        document.getElementById("input-gra").value = nuevasGra;

                        // NUEVO: Guardar en la memoria del teléfono para que no se borre al cerrar la app
                        localStorage.setItem('gymlytics_macros_hoy', JSON.stringify({
                            cal: nuevasCal, pro: nuevasPro, car: nuevosCar, gra: nuevasGra
                        }));
                    }
                    //hablar(datos.resumen);
                    // Si es entrenamiento, el backend ya lo guardó en la base de datos, 
                    // así que no necesitamos hacer nada más en la pantalla de nutrición.
                    
                } else {
                    chat.innerHTML += `<div class="burbuja-error"><strong class="color-red">🤖 IA:</strong> Uy, me confundí. ¿Puedes describir esa comida un poco mejor?</div>`;
                }
            } catch (e) {
                document.getElementById(idCarga).remove();
                chat.innerHTML += `<div style="background: #2a0808; padding: 10px; border-radius: 8px; border-left: 4px solid #dc3545; align-self: flex-start; max-width: 85%; color: #e0e0e0;"><strong style="color: #dc3545;">🤖 IA:</strong> Error de conexión con el servidor.</div>`;
            } finally {
                // DESBLOQUEO: Volvemos a encender todo pase lo que pase
                input.disabled = false;
                if(btnEnviar) btnEnviar.disabled = false;
                input.focus(); // Regresamos el cursor a la cajita
            }
            
            chat.scrollTop = chat.scrollHeight; 
        }
        async function guardarRegistroDiario() {
            // 1. Recolectamos los datos de las cajitas
            const calorias = document.getElementById("input-cal").value;
            const proteinas = document.getElementById("input-pro").value;
            const carbohidratos = document.getElementById("input-car").value;
            const grasas = document.getElementById("input-gra").value;
            const sueno = document.getElementById("input-sueno").value;
            const mensajeDiv = document.getElementById("mensaje-rec");

            // 2. Verificamos que el usuario haya llenado todo
            if (!calorias || !proteinas || !carbohidratos || !grasas || !sueno) {
                mensajeDiv.innerHTML = "<span style='color: #dc3545; font-weight: bold;'>⚠️ Por favor, llena todos los campos (incluyendo el sueño) antes de guardar.</span>";
                return;
            }

            mensajeDiv.innerHTML = "<span style='color: #555;'>Guardando en la base de datos... ⏳</span>";
            const token = obtenerTokenActivo(); // Extraemos tu llave de seguridad

            try {
                // 3. Enviamos el paquete a tu servidor de Python
                const res = await fetch(`${API_BASE}/progreso/registro-diario`, {
                    method: "POST",
                    headers: { 
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${token}`
                    },
                    body: JSON.stringify({ 
                        calorias: parseFloat(calorias),
                        proteinas: parseFloat(proteinas),
                        carbohidratos: parseFloat(carbohidratos),
                        grasas: parseFloat(grasas),
                        horas_sueno: parseFloat(sueno)
                    })
                });

                if (res.ok) {
                    mensajeDiv.innerHTML = "<span style='color: #34a853; font-weight: bold;'>¡Progreso guardado con éxito! ✅</span>";
                    
                    // Opcional: Limpiamos las cajitas después de guardar
                    document.getElementById("input-cal").value = "";
                    document.getElementById("input-pro").value = "";
                    document.getElementById("input-car").value = "";
                    document.getElementById("input-gra").value = "";
                    document.getElementById("input-sueno").value = "";
                    localStorage.removeItem('gymlytics_macros_hoy');
                } else {
                    const error = await res.json();
                    mensajeDiv.innerHTML = `<span style='color: #dc3545;'>❌ Error del servidor: ${error.detail}</span>`;
                }
            } catch (e) {
                mensajeDiv.innerHTML = "<span style='color: #dc3545;'>❌ Error de conexión con el servidor.</span>";
            }
        }
        // --- MÓDULO DE RECONOCIMIENTO DE VOZ ---
        function iniciarDictado() {
            const btnMicro = document.getElementById("btn-microfono");
            const inputComida = document.getElementById("input-comida");
            const estadoTexto = document.getElementById("estado-microfono");

            // Verificamos si el navegador soporta la API de voz
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            
            if (!SpeechRecognition) {
                estadoTexto.innerHTML = "<span style='color: #dc3545;'>Tu navegador no soporta el dictado por voz.</span>";
                return;
            }

            const reconocimiento = new SpeechRecognition();
            reconocimiento.lang = 'es-MX'; // Ajustamos al español de México (o tu región)
            reconocimiento.interimResults = false; // Solo devuelve el texto final, no borradores
            reconocimiento.maxAlternatives = 1;

            // Qué pasa cuando empieza a escuchar
            reconocimiento.onstart = function() {
                btnMicro.style.backgroundColor = "#ff5252"; // Rojo más brillante
                btnMicro.style.borderColor = "#fff";
                btnMicro.style.boxShadow = "0 0 20px rgba(255, 82, 82, 0.8)";
                btnMicro.innerText = "🔴"; // Cambiamos el icono para indicar "grabando"
                estadoTexto.innerText = "Escuchando... Habla ahora.";
                inputComida.placeholder = "Escuchando...";
            };

            // Qué pasa cuando recibe un resultado válido
            reconocimiento.onresult = function(event) {
                const textoDictado = event.results[0][0].transcript;
                inputComida.value = textoDictado; // Ponemos el texto en la cajita
                estadoTexto.innerText = "¡Texto capturado, enviando! 🚀";
                
                // ¡AQUÍ ESTÁ LA MAGIA! 
                // Al quitar las dos diagonales (//), la función se ejecuta sola
                analizarComidaEnUI(); 
            };

            // Qué pasa si hay un error o el usuario se queda callado
            reconocimiento.onerror = function(event) {
                estadoTexto.innerHTML = `<span style='color: #dc3545;'>Error: ${event.error}</span>`;
                restaurarBotonMicro();
            };

            // Qué pasa cuando termina (ya sea por éxito o silencio)
            reconocimiento.onend = function() {
                restaurarBotonMicro();
            };

            // Función auxiliar para regresar el botón a la normalidad
            function restaurarBotonMicro() {
                btnMicro.style.backgroundColor = "#e53935";
                btnMicro.style.borderColor = "transparent";
                btnMicro.style.boxShadow = "0 0 10px rgba(229, 57, 53, 0.4)";
                btnMicro.innerText = "🎤";
                inputComida.placeholder = "Ej: De desayuno comí 3 huevos...";
                
                // Borramos el estado después de 2 segundos
                setTimeout(() => {
                    if (estadoTexto.innerText !== "Escuchando... Habla ahora.") {
                        estadoTexto.innerText = "";
                    }
                }, 2000);
            }

            // ¡Arrancamos el motor!
            reconocimiento.start();
        }
        // --- MÓDULO DE SÍNTESIS DE VOZ ---
        function hablar(texto) {
            // Verificamos si el navegador soporta hablar
            if ('speechSynthesis' in window) {
                // Limpiamos los emojis o textos raros que la voz robótica no sepa leer
                const textoLimpio = texto.replace(/🤖|IA:|¡Anotado!|¡Macros calculados.../g, '').trim();
                
                const mensajeVoz = new SpeechSynthesisUtterance(textoLimpio);
                mensajeVoz.lang = 'es-MX'; // Acento latino
                mensajeVoz.rate = 1.0; // Velocidad normal (0.1 a 10)
                mensajeVoz.pitch = 1.0; // Tono de voz
                
                window.speechSynthesis.speak(mensajeVoz);
            }
        }