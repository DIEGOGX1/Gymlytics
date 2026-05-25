from fastapi import FastAPI, Depends, HTTPException
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import create_engine, Column, Integer, String, Float, DateTime, ForeignKey, func
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session
import datetime
from zoneinfo import ZoneInfo
from pydantic import BaseModel
from typing import Optional
from pydantic import BaseModel
# Definir el horario
# Definir el horario
def obtener_hora_mexico():
    zona_mx = ZoneInfo("America/Mexico_City")
    # Extraemos la hora exacta de México y la volvemos "ingenua" para que Postgres no la cambie a UTC
    return datetime.datetime.now(zona_mx).replace(tzinfo=None)

# ==========================================
# 1. CONFIGURACIÓN DE LA BASE DE DATOS
# ==========================================
DATABASE_URL = "postgresql://neondb_owner:npg_X8beVmQ2CBpD@ep-lively-haze-apz76kao-pooler.c-7.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"

engine = create_engine(DATABASE_URL) # Quita el connect_args de SQLite, ya no se ocupa
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# ==========================================
# 2. MODELOS DE DATOS (Las Tablas)
# ==========================================
class Usuario(Base):
    __tablename__ = "usuarios"
    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String, index=True)
    contrasena = Column(String) # <--- NUEVO CAMPO
    meta = Column(String)

class Biometria(Base):
    __tablename__ = "biometrias"
    id = Column(Integer, primary_key=True, index=True)
    usuario_id = Column(Integer, ForeignKey("usuarios.id"))
    
    # OPTIMIZACIÓN: index=True nos permitirá saber al instante la fecha del último pesaje
    fecha = Column(DateTime, default=obtener_hora_mexico, index=True) 
    
    peso_corporal = Column(Float)
    porcentaje_grasa = Column(Float, nullable=True)
    
    # NUEVAS COLUMNAS: Ajustes métricos para el reporte de recomposición corporal
    perimetro_cintura = Column(Float, nullable=True)
    perimetro_brazo = Column(Float, nullable=True)
    perimetro_pierna = Column(Float, nullable=True)

# --- NUEVA TABLA: MATERIALIZACIÓN DE DATOS SEMANALES ---

class ResumenSemanal(Base):
    __tablename__ = "resumen_semanal"
    id = Column(Integer, primary_key=True, index=True)
    usuario_id = Column(Integer, ForeignKey("usuarios.id"))
    
    # Fecha en la que se generó este reporte de corte
    fecha_corte = Column(DateTime, default=obtener_hora_mexico, index=True)
    
    # Variables consolidadas de la semana
    promedio_calorias = Column(Float)
    promedio_sueno = Column(Float)
    variacion_peso = Column(Float)
    
    # El veredicto analítico final (Recomposición, superávit, etc.)
    dictamen_ia = Column(String)
# --- NUEVAS TABLAS ---
class Ejercicio(Base):
    __tablename__ = "ejercicios"
    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String, unique=True, index=True)  # Ej: "Sentadilla Libre"
    grupo_muscular = Column(String)                   # Ej: "Pierna"

class RegistroSerie(Base):
    __tablename__ = "registro_series"
    id = Column(Integer, primary_key=True, index=True)
    usuario_id = Column(Integer, ForeignKey("usuarios.id"))
    ejercicio_id = Column(Integer, ForeignKey("ejercicios.id"))
    
    # OPTIMIZACIÓN: Añadimos index=True para acelerar los reportes temporales
    fecha = Column(DateTime, default=obtener_hora_mexico, index=True)
    
    numero_serie = Column(Integer)
    peso_kg = Column(Float)
    repeticiones = Column(Integer)

class RecuperacionDiaria(Base):
    __tablename__ = "recuperacion_diaria"
    id = Column(Integer, primary_key=True, index=True)
    usuario_id = Column(Integer, ForeignKey("usuarios.id"))
    
    # OPTIMIZACIÓN: Añadimos index=True para que los promedios semanales vuelen
    fecha = Column(DateTime, default=obtener_hora_mexico, index=True)
    
    horas_sueno = Column(Float)
    carbohidratos_pre_entreno = Column(Float) 
    calorias_ayer = Column(Float)

# Molde para recibir datos del Front-End en formato JSON
class DatosSerieRecepcion(BaseModel):
    usuario_id: int
    ejercicio_id: int
    numero_serie: int
    peso_kg: float
    repeticiones: int

def sembrar_datos_iniciales(db: Session):
    # Verificar si ya existen ejercicios
    if db.query(Ejercicio).first() is None:
        ejercicios_base = [
            Ejercicio(nombre="Sentadilla Libre", grupo_muscular="Pierna"),
            Ejercicio(nombre="Press Banca", grupo_muscular="Pecho"),
            Ejercicio(nombre="Peso Muerto", grupo_muscular="Espalda"),
            Ejercicio(nombre="Press Militar", grupo_muscular="Hombro"),
            Ejercicio(nombre="Curl Bíceps", grupo_muscular="Bíceps")
        ]
        db.bulk_save_objects(ejercicios_base)
        db.commit()
        print("Datos maestros cargados correctamente.")

    # Verificar si ya existen usuarios
    if db.query(Usuario).first() is None:
        usuario_base = Usuario(nombre="Diego Gaxiola", meta="Hipertrofia")
        db.add(usuario_base)
        db.commit()
        print("Usuario inicial cargado.")


# Crear las tablas
Base.metadata.create_all(bind=engine)

# Sembrar datos (Ejecuta la función justo después de crear las tablas)
db_inicial = SessionLocal()
sembrar_datos_iniciales(db_inicial)
db_inicial.close()

# ==========================================
# 3. RUTAS DE LA API (Endpoints)
# ==========================================
app = FastAPI(title="Sistema de Entrenamiento Inteligente")

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
class LoginRequest(BaseModel):
    nombre: str
    contrasena: str

@app.post("/login")
def iniciar_sesion(req: LoginRequest, db: Session = Depends(get_db)):
    # Buscamos que coincida el nombre Y la contraseña
    usuario = db.query(Usuario).filter(
        Usuario.nombre == req.nombre, 
        Usuario.contrasena == req.contrasena
    ).first()

    if not usuario:
        # Si no coinciden, lanzamos un error 401 (No autorizado)
        raise HTTPException(status_code=401, detail="Usuario o contraseña incorrectos")

    # Si todo está bien, le devolvemos su ID y nombre
    return {"usuario_id": usuario.id, "nombre": usuario.nombre}
# ==========================================
# CONFIGURACIÓN DE CORS (El puente al Front-End)
# ==========================================
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Permite que cualquier página HTML se conecte (ideal para desarrollo local)
    allow_credentials=True,
    allow_methods=["*"],  # Permite usar GET, POST, etc.
    allow_headers=["*"],
)

# Ruta raíz: Entrega la interfaz visual al usuario
@app.get("/")
def iniciar_interfaz():
    return FileResponse("index.html")

# Rutas de Usuarios (las que ya probaste)
@app.post("/api/usuarios")
def crear_usuario(nombre: str, meta: str, db: Session = Depends(get_db)):
    nuevo_usuario = Usuario(nombre=nombre, meta=meta)
    db.add(nuevo_usuario)
    db.commit()
    db.refresh(nuevo_usuario)
    return nuevo_usuario

@app.get("/api/usuarios")
def obtener_usuarios(db: Session = Depends(get_db)):
    return db.query(Usuario).all()

# 1.B Obtener todo el catálogo de ejercicios
@app.get("/api/ejercicios")
def obtener_ejercicios(db: Session = Depends(get_db)):
    ejercicios = db.query(Ejercicio).all()
    return ejercicios

# --- NUEVAS RUTAS DE ENTRENAMIENTO ---

# 1. Crear un ejercicio en el catálogo
@app.post("/api/ejercicios")
def crear_ejercicio(nombre: str, grupo_muscular: str, db: Session = Depends(get_db)):
    nuevo_ejercicio = Ejercicio(nombre=nombre, grupo_muscular=grupo_muscular)
    db.add(nuevo_ejercicio)
    db.commit()
    db.refresh(nuevo_ejercicio)
    return nuevo_ejercicio

# 2. Registrar una serie terminada (¡El reemplazo de tu Excel!)

@app.post("/api/entrenamiento/registrar-serie")
def registrar_serie(datos: DatosSerieRecepcion, db: Session = Depends(get_db)):
    
    hoy = obtener_hora_mexico().date()

    # Buscamos usando el paquete 'datos'
    registros_previos = db.query(RegistroSerie).filter(
        RegistroSerie.usuario_id == datos.usuario_id,
        RegistroSerie.ejercicio_id == datos.ejercicio_id,
        RegistroSerie.numero_serie == datos.numero_serie
    ).all()

    serie_repetida = any(registro.fecha.date() == hoy for registro in registros_previos)

    if serie_repetida:
        raise HTTPException(
            status_code=400, 
            detail=f"La serie {datos.numero_serie} ya fue registrada hoy para este ejercicio."
        )

    # Guardamos extrayendo del paquete 'datos'
    nueva_serie = RegistroSerie(
        usuario_id=datos.usuario_id,
        ejercicio_id=datos.ejercicio_id,
        numero_serie=datos.numero_serie,
        peso_kg=datos.peso_kg,
        repeticiones=datos.repeticiones
    )
    db.add(nueva_serie)
    db.commit()
    db.refresh(nueva_serie)
    return {"mensaje": "Serie registrada con éxito", "datos": nueva_serie}

# 3. Ver el historial de un usuario
@app.get("/api/entrenamiento/historial/{usuario_id}")
def obtener_historial(usuario_id: int, db: Session = Depends(get_db)):
    # Buscamos todas las series donde el usuario_id coincida
    historial = db.query(RegistroSerie).filter(RegistroSerie.usuario_id == usuario_id).all()
    return historial

# 4. Motor de Análisis: Calcular Series por Grupo Muscular (Hipertrofia)
@app.get("/api/entrenamiento/analisis/series-hoy/{usuario_id}")
def calcular_series_musculo_hoy(usuario_id: int, db: Session = Depends(get_db)):
    hoy = obtener_hora_mexico().date()
    
    # 1. Traemos todas las series del usuario
    registros_totales = db.query(RegistroSerie).filter(
        RegistroSerie.usuario_id == usuario_id
    ).all()
    
    # 2. Filtramos solo las que se hicieron el día de hoy
    series_hoy = [serie for serie in registros_totales if serie.fecha.date() == hoy]
    
    # 3. Creamos un diccionario vacío para ir contando
    conteo_musculos = {}
    
    # 4. Iteramos sobre cada serie que hiciste hoy
    for serie in series_hoy:
        # Buscamos qué ejercicio es en el catálogo
        ejercicio = db.query(Ejercicio).filter(Ejercicio.id == serie.ejercicio_id).first()
        
        if ejercicio:
            musculo = ejercicio.grupo_muscular
            
            # Si el músculo ya está en el diccionario, le sumamos 1 serie
            if musculo in conteo_musculos:
                conteo_musculos[musculo] += 1
            # Si no está, lo agregamos empezando con 1
            else:
                conteo_musculos[musculo] = 1
                
    return {
        "usuario_id": usuario_id,
        "fecha": hoy,
        "total_series_dia": len(series_hoy),
        "desglose_por_musculo": conteo_musculos,
        "mensaje_sistema": "Métrica de hipertrofia calculada correctamente."
    }

# --- MÓDULO DE PREDICCIÓN Y RECUPERACIÓN ---

# 1. Guardar o Actualizar datos de recuperación del día
@app.post("/api/recuperacion")
def registrar_recuperacion(usuario_id: int, horas_sueno: float, carbohidratos_pre: float, calorias_ayer: float, db: Session = Depends(get_db)):
    hoy = obtener_hora_mexico().date()
    
    # Buscamos el último registro de este usuario
    ultimo_registro = db.query(RecuperacionDiaria).filter(
        RecuperacionDiaria.usuario_id == usuario_id
    ).order_by(RecuperacionDiaria.fecha.desc()).first()
    
    # REGLA UPSERT: Si existe un registro y es del día de hoy, lo ACTUALIZAMOS
    if ultimo_registro and ultimo_registro.fecha.date() == hoy:
        ultimo_registro.horas_sueno = horas_sueno
        ultimo_registro.carbohidratos_pre_entreno = carbohidratos_pre
        ultimo_registro.calorias_ayer = calorias_ayer
        
        db.commit()
        db.refresh(ultimo_registro)
        return {"mensaje": "Datos actualizados correctamente", "datos": ultimo_registro}
    
    # Si no hay registro de hoy, CREAMOS uno completamente nuevo
    nuevo_registro = RecuperacionDiaria(
        usuario_id=usuario_id,
        horas_sueno=horas_sueno,
        carbohidratos_pre_entreno=carbohidratos_pre,
        calorias_ayer=calorias_ayer
    )
    db.add(nuevo_registro)
    db.commit()
    db.refresh(nuevo_registro)
    return {"mensaje": "Nuevos datos guardados", "datos": nuevo_registro}

# 2. Algoritmo Predictivo de Rendimiento (Con Doble Progresión)
@app.get("/api/entrenamiento/prediccion/{usuario_id}/{ejercicio_id}/{numero_serie}")
def predecir_rendimiento(usuario_id: int, ejercicio_id: int, numero_serie: int, db: Session = Depends(get_db)):
    
    ultima_serie = db.query(RegistroSerie).filter(
        RegistroSerie.usuario_id == usuario_id,
        RegistroSerie.ejercicio_id == ejercicio_id,
        RegistroSerie.numero_serie == numero_serie
    ).order_by(RegistroSerie.fecha.desc()).first()

    if not ultima_serie:
        return {
            "mensaje": f"No hay historial previo para la Serie {numero_serie}.",
            "objetivo_hoy": "Usa una carga pesada (RIR 2)."
        }

    recuperacion = db.query(RecuperacionDiaria).filter(
        RecuperacionDiaria.usuario_id == usuario_id
    ).order_by(RecuperacionDiaria.fecha.desc()).first()

    if not recuperacion:
        return {"mensaje": "No hay datos de recuperación hoy."}

    # CÁLCULO DEL READINESS SCORE
    puntaje = 100.0
    if recuperacion.horas_sueno < 6:
        puntaje -= 15.0
    elif recuperacion.horas_sueno < 7:
        puntaje -= 5.0
    elif recuperacion.horas_sueno >= 8:
        puntaje += 5.0

    if recuperacion.carbohidratos_pre_entreno < 30:
        puntaje -= 10.0
    
    recomendacion_texto = ""
    objetivo_hoy_texto = ""

    # LÓGICA DE DOBLE PROGRESIÓN (Opciones A y B)
    if puntaje >= 100:
        if ultima_serie.repeticiones >= 11:
            # Límite alcanzado: Forzar subida de peso
            recomendacion_texto = f"¡Recuperación óptima! Techo de reps alcanzado. Toca subir peso en la Serie {numero_serie}."
            objetivo_hoy_texto = f"{ultima_serie.peso_kg + 2.5}kg x {ultima_serie.repeticiones} reps"
        else:
            # Flexibilidad: Dar a elegir entre subir peso o sacar 1 rep extra
            recomendacion_texto = f"¡Recuperación óptima! Elige tu progresión para la Serie {numero_serie}:"
            objetivo_hoy_texto = f"Opción A: {ultima_serie.peso_kg + 2.5}kg x {ultima_serie.repeticiones} reps \nOpción B: {ultima_serie.peso_kg}kg x {ultima_serie.repeticiones + 1} reps"
            
    elif puntaje >= 85:
        recomendacion_texto = f"Recuperación normal. Iguala la carga de la Serie {numero_serie} anterior."
        objetivo_hoy_texto = f"{ultima_serie.peso_kg}kg x {ultima_serie.repeticiones} reps"
    else:
        recomendacion_texto = "Fatiga acumulada. Reduce la intensidad en esta serie para proteger el SNC."
        peso_reducido = ultima_serie.peso_kg - (ultima_serie.peso_kg * 0.10)
        reps_reducidas = ultima_serie.repeticiones - 1
        objetivo_hoy_texto = f"{peso_reducido}kg x {reps_reducidas} reps"

    return {
        "ejercicio_id": ejercicio_id,
        "numero_serie": numero_serie,
        "sesion_anterior": f"{ultima_serie.peso_kg}kg x {ultima_serie.repeticiones} reps",
        "puntaje_recuperacion": f"{puntaje}%",
        "recomendacion_algoritmo": recomendacion_texto,
        "objetivo_hoy": objetivo_hoy_texto,
        "factores": {
            "sueño": recuperacion.horas_sueno,
            "carbs_pre_entreno": recuperacion.carbohidratos_pre_entreno
        }
    }

# ==========================================
# 3. ANALÍTICA DE CORRELACIÓN DE DATOS MÁXIMA
# ==========================================
@app.get("/api/analisis/correlacion/{usuario_id}/{ejercicio_id}")
def analisis_correlacion(usuario_id: int, ejercicio_id: int, db: Session = Depends(get_db)):
    # 1. Buscar las últimas 2 sesiones de entrenamiento (Serie 1)
    sesiones = db.query(RegistroSerie).filter(
        RegistroSerie.usuario_id == usuario_id,
        RegistroSerie.ejercicio_id == ejercicio_id,
        RegistroSerie.numero_serie == 1
    ).order_by(RegistroSerie.fecha.desc()).limit(2).all()

    if len(sesiones) < 2:
        return {"error": "Necesitas registrar al menos 2 sesiones (en días distintos) para comparar el progreso temporal."}

    hoy_train = sesiones[0]
    ant_train = sesiones[1]

    # 2. Buscar los últimos 2 registros de recuperación correspondientes
    recuperaciones = db.query(RecuperacionDiaria).filter(
        RecuperacionDiaria.usuario_id == usuario_id
    ).order_by(RecuperacionDiaria.fecha.desc()).limit(2).all()

    # Extraemos los datos de hoy y de la sesión anterior con candados por si no existen
    sueno_hoy = recuperaciones[0].horas_sueno if len(recuperaciones) > 0 else 0
    sueno_ant = recuperaciones[1].horas_sueno if len(recuperaciones) > 1 else 0

    calorias_hoy = recuperaciones[0].calorias_ayer if len(recuperaciones) > 0 else 0
    calorias_ant = recuperaciones[1].calorias_ayer if len(recuperaciones) > 1 else 0

    carbs_hoy = recuperaciones[0].carbohidratos_pre_entreno if len(recuperaciones) > 0 else 0
    carbs_ant = recuperaciones[1].carbohidratos_pre_entreno if len(recuperaciones) > 1 else 0

    # 3. Matemáticas de Comparación (Deltas)
    dif_peso = hoy_train.peso_kg - ant_train.peso_kg
    dif_reps = hoy_train.repeticiones - ant_train.repeticiones
    dif_sueno = round(sueno_hoy - sueno_ant, 1)
    dif_calorias = int(calorias_hoy - calorias_ant)
    dif_carbs = int(carbs_hoy - carbs_ant)

    # 4. Construcción del desglose de cambios para el usuario
    cambios_recuperacion = f"• Sueño: {sueno_hoy}h ({'+' if dif_sueno >= 0 else ''}{dif_sueno}h vs sesión anterior)<br>" \
                           f"• Energía: {calorias_hoy} kcal ({'+' if dif_calorias >= 0 else ''}{dif_calorias} kcal vs sesión anterior)<br>" \
                           f"• Carbohidratos Pre: {carbs_hoy}g ({'+' if dif_carbs >= 0 else ''}{dif_carbs}g vs sesión anterior)"

    # 5. Lógica del Dictamen de Causa-Efecto
    dictamen = ""
    
    # Caso A: Hubo mejora (en peso o en repeticiones)
    if dif_peso > 0 or (dif_peso == 0 and dif_reps > 0):
        logro = f"subiste {dif_peso}kg" if dif_peso > 0 else f"lograste {dif_reps} reps extra"
        if dif_sueno >= 0 and dif_calorias >= 0:
            dictamen = f"Aumento de rendimiento detectado ({logro}). El análisis demuestra que esto se debe a un superávit de recursos: consumiste más calorías (+{dif_calorias} kcal) y dormiste mejor (+{dif_sueno}h)."
        elif dif_calorias > 150:
            dictamen = f"Aumento de rendimiento detectado ({logro}). La carga extra de glucógeno y energía (+{dif_calorias} kcal) compensó cualquier otra variable. ¡Excelente recarga!"
        else:
            dictamen = f"Aumento de rendimiento detectado ({logro}). Tu eficiencia neuromuscular o motivación compensó las fluctuaciones de tu descanso."

    # Caso B: Hubo un retroceso o estancamiento
    elif dif_peso < 0 or (dif_peso == 0 and dif_reps < 0):
        perdida = f"caíste {abs(dif_peso)}kg" if dif_peso < 0 else f"perdiste {abs(dif_reps)} reps"
        if dif_sueno < 0 or dif_calorias < 0:
            dictamen = f"Pérdida de rendimiento detectada ({perdida}). El culpable está claro en tus métricas de recuperación: "
            if dif_sueno < 0:
                dictamen += f"Dormiste {-dif_sueno}h MENOS de lo habitual afectando tu SNC. "
            if dif_calorias < 0:
                dictamen += f"Entraste con un déficit energético de {-dif_calorias} kcal respecto a la sesión pasada."
        else:
            dictamen = f"Pérdida de rendimiento detectada ({perdida}). Tus factores de descanso se mantuvieron estables, por lo que este bajón apunta a fatiga acumulada del volumen semanal o estrés externo."
            
    # Caso C: Rendimiento idéntico
    else:
        dictamen = "Rendimiento idéntico. Mantuviste los kilos y las repeticiones bajo las mismas condiciones de recuperación."

    return {
        "analisis_ia": dictamen,
        "desglose_numerico": cambios_recuperacion,
        "estadisticas": {
            "peso_delta": dif_peso,
            "reps_delta": dif_reps,
            "sueno_delta": dif_sueno,
            "calorias_delta": dif_calorias
        }
    }

# ==========================================
# 4. MÓDULO DE COMPOSICIÓN CORPORAL Y BLOQUEOS
# ==========================================

# A. Molde para recibir datos del nuevo pesaje
class DatosBiometriaRecepcion(BaseModel):
    usuario_id: int
    peso_corporal: float
    porcentaje_grasa: Optional[float] = None
    perimetro_cintura: Optional[float] = None
    perimetro_brazo: Optional[float] = None
    perimetro_pierna: Optional[float] = None

# B. El Guardia de Seguridad: Verifica si han pasado 7 días
@app.get("/api/biometria/estado/{usuario_id}")
def estado_biometria(usuario_id: int, db: Session = Depends(get_db)):
    # Buscamos el último registro de este usuario
    ultimo_registro = db.query(Biometria).filter(
        Biometria.usuario_id == usuario_id
    ).order_by(Biometria.fecha.desc()).first()

    hoy = obtener_hora_mexico().date()

    # Si es un usuario nuevo y no tiene registros, bloqueo automático
    if not ultimo_registro:
        return {
            "requiere_pesaje": True,
            "dias_transcurridos": 0,
            "mensaje": "¡Bienvenido a SEAFIT! Necesitamos tus datos iniciales de biometría para comenzar."
        }

    # Calculamos la diferencia exacta en días
    fecha_ultimo = ultimo_registro.fecha.date()
    dias_transcurridos = (hoy - fecha_ultimo).days

    # Si pasaron 7 días o más, activamos el bloqueo
    if dias_transcurridos >= 7:
        return {
            "requiere_pesaje": True,
            "dias_transcurridos": dias_transcurridos,
            "mensaje": f"Han pasado {dias_transcurridos} días desde tu último registro. Es hora de actualizar tus métricas obligatorias."
        }
    
    # Si todo está en orden, le damos luz verde
    return {
        "requiere_pesaje": False,
        "dias_transcurridos": dias_transcurridos,
        "mensaje": "Biometría al día. Puedes entrenar."
    }

# C. Ruta para guardar la biometría y quitar el bloqueo
@app.post("/api/biometria/registrar")
def registrar_biometria(datos: DatosBiometriaRecepcion, db: Session = Depends(get_db)):
    nuevo_pesaje = Biometria(
        usuario_id=datos.usuario_id,
        peso_corporal=datos.peso_corporal,
        porcentaje_grasa=datos.porcentaje_grasa,
        perimetro_cintura=datos.perimetro_cintura,
        perimetro_brazo=datos.perimetro_brazo,
        perimetro_pierna=datos.perimetro_pierna
    )
    db.add(nuevo_pesaje)
    db.commit()
    return {"mensaje": "Biometría registrada exitosamente. ¡Sistema desbloqueado!"}

# ==========================================
# 5. EL CEREBRO SEMANAL (Análisis Holístico Avanzado)
# ==========================================
import datetime

@app.get("/api/analisis/semanal/{usuario_id}")
def analisis_semanal(usuario_id: int, db: Session = Depends(get_db)):
    usuario = db.query(Usuario).filter(Usuario.id == usuario_id).first()
    if not usuario:
        return {"error": "Usuario no encontrado."}
    
    # 1. BIOMETRÍA: Obtener los dos últimos pesajes
    biometrias = db.query(Biometria).filter(
        Biometria.usuario_id == usuario_id
    ).order_by(Biometria.fecha.desc()).limit(2).all()

    if len(biometrias) < 2:
        return {"error": "Necesitas al menos 2 semanas de registros biométricos para calcular tendencias."}

    dif_peso = round(biometrias[0].peso_corporal - biometrias[1].peso_corporal, 2)

    # 2. DEFINIR LA LÍNEA DE TIEMPO (Semana actual vs Semana anterior)
    hoy = obtener_hora_mexico().date()
    hace_7_dias = hoy - datetime.timedelta(days=7)
    hace_14_dias = hoy - datetime.timedelta(days=14)
    
    # 3. RECUPERACIÓN: Comparativa calórica y de sueño
    rec_actual = db.query(RecuperacionDiaria).filter(
        RecuperacionDiaria.usuario_id == usuario_id, RecuperacionDiaria.fecha >= hace_7_dias).all()
    rec_pasada = db.query(RecuperacionDiaria).filter(
        RecuperacionDiaria.usuario_id == usuario_id, RecuperacionDiaria.fecha >= hace_14_dias, RecuperacionDiaria.fecha < hace_7_dias).all()

    prom_cal_actual = sum(r.calorias_ayer for r in rec_actual) / len(rec_actual) if rec_actual else 0
    prom_sueno_actual = sum(r.horas_sueno for r in rec_actual) / len(rec_actual) if rec_actual else 0
    
    # Si no hay datos de la semana pasada, asumimos que se mantuvo igual para no romper las matemáticas
    prom_cal_pasado = sum(r.calorias_ayer for r in rec_pasada) / len(rec_pasada) if rec_pasada else prom_cal_actual
    prom_sueno_pasado = sum(r.horas_sueno for r in rec_pasada) / len(rec_pasada) if rec_pasada else prom_sueno_actual

    dif_calorias = round(prom_cal_actual - prom_cal_pasado, 1)
    dif_sueno = round(prom_sueno_actual - prom_sueno_pasado, 1)

# 4. RENDIMIENTO: Comparativa de Sobrecarga Real (Peso/Reps por Ejercicio)
    series_actual = db.query(RegistroSerie).filter(
        RegistroSerie.usuario_id == usuario_id, RegistroSerie.fecha >= hace_7_dias).all()
    series_pasada = db.query(RegistroSerie).filter(
        RegistroSerie.usuario_id == usuario_id, RegistroSerie.fecha >= hace_14_dias, RegistroSerie.fecha < hace_7_dias).all()

    # Agrupar por ejercicio para sacar el mejor set de cada semana
    mejores_actual = {}
    for s in series_actual:
        if s.ejercicio_id not in mejores_actual:
            mejores_actual[s.ejercicio_id] = s
        else:
            if s.peso_kg > mejores_actual[s.ejercicio_id].peso_kg or (s.peso_kg == mejores_actual[s.ejercicio_id].peso_kg and s.repeticiones > mejores_actual[s.ejercicio_id].repeticiones):
                mejores_actual[s.ejercicio_id] = s

    mejores_pasada = {}
    for s in series_pasada:
        if s.ejercicio_id not in mejores_pasada:
            mejores_pasada[s.ejercicio_id] = s
        else:
            if s.peso_kg > mejores_pasada[s.ejercicio_id].peso_kg or (s.peso_kg == mejores_pasada[s.ejercicio_id].peso_kg and s.repeticiones > mejores_pasada[s.ejercicio_id].repeticiones):
                mejores_pasada[s.ejercicio_id] = s

    ejercicios_mejorados = 0
    ejercicios_mantenidos = 0
    ejercicios_peores = 0
    total_comparados = 0

    for ej_id, serie_act in mejores_actual.items():
        if ej_id in mejores_pasada:
            total_comparados += 1
            serie_pas = mejores_pasada[ej_id]
            if serie_act.peso_kg > serie_pas.peso_kg:
                ejercicios_mejorados += 1
            elif serie_act.peso_kg == serie_pas.peso_kg and serie_act.repeticiones > serie_pas.repeticiones:
                ejercicios_mejorados += 1
            elif serie_act.peso_kg == serie_pas.peso_kg and serie_act.repeticiones == serie_pas.repeticiones:
                ejercicios_mantenidos += 1
            else:
                ejercicios_peores += 1

    # 5. DIAGNÓSTICO ESTRUCTURADO DE LA IA
    meta = usuario.meta.upper()
    dictamen = f"🎯 <strong>Evaluando tu meta de {meta}:</strong><br><br>"

    # Bloque A: Análisis de Composición (Peso vs Calorías)
    if dif_peso > 0:
        dictamen += f"⚖️ <strong>Peso:</strong> Subiste {dif_peso} kg. "
        if dif_calorias > 0:
            dictamen += f"Es una respuesta matemática lógica porque aumentaste tu energía media diaria en {dif_calorias} kcal. "
        else:
            dictamen += f"Tu peso subió a pesar de mantener/bajar tus calorías medias ({int(prom_cal_actual)} kcal). Revisa la retención de líquidos o si estás midiendo mal tus porciones. "
    elif dif_peso < 0:
        dictamen += f"⚖️ <strong>Peso:</strong> Bajaste {abs(dif_peso)} kg. "
        if dif_calorias < 0:
            dictamen += f"Tu recorte de {abs(dif_calorias)} kcal diarias está dando frutos exactos en la báscula. "
        else:
            dictamen += f"Perdiste peso sin bajar tus calorías ({int(prom_cal_actual)} kcal). Tu metabolismo basal o gasto por actividad (NEAT) aumentó esta semana. "
    else:
        dictamen += f"⚖️ <strong>Peso:</strong> Sin cambios. Tus {int(prom_cal_actual)} kcal actuales son exactamente tu caloría de mantenimiento. "

    # Bloque B: Análisis de Rendimiento (Fuerza real vs Fatiga)
    dictamen += "<br><br>🏋️ <strong>Rendimiento Global:</strong> "
    
    if total_comparados == 0:
        dictamen += "No hay suficientes datos de ejercicios coincidentes entre esta semana y la anterior para evaluar tu progreso real de fuerza."
    elif ejercicios_mejorados > ejercicios_peores:
        dictamen += "¡Sobrecarga progresiva lograda! En promedio, lograste levantar más peso o sacar más repeticiones con las mismas cargas que la semana pasada. "
        if dif_peso <= 0:
            dictamen += "¡Esta es la señal absoluta de RECOMPOSICIÓN CORPORAL! Estás ganando fuerza neta mientras pierdes o mantienes peso."
    elif ejercicios_peores > ejercicios_mejorados:
        dictamen += "Tu fuerza promedio retrocedió. Lograste menos repeticiones o tuviste que bajar los pesos en comparación con la semana anterior. "
        if dif_sueno < 0 or prom_sueno_actual < 7:
            dictamen += f"La causa principal es la falta de recuperación: perdiste {abs(dif_sueno)}h de sueño. Tu SNC no se está recuperando."
        elif dif_calorias < -200:
            dictamen += "Un déficit calórico muy agresivo está comprometiendo tu producción de fuerza."
        else:
            dictamen += "Tu recuperación parece estable, revisa fatiga acumulada o técnica de ejecución."
    else:
        dictamen += "Fuerza estancada. Levantaste exactamente los mismos pesos y repeticiones promedio que la semana pasada."

    # Bloque C: Calidad de Sueño
    dictamen += f"<br><br>🌙 <strong>Descanso:</strong> Promedio de {round(prom_sueno_actual, 1)}h por noche. "
    if prom_sueno_actual >= 7:
        dictamen += "Óptimo para reparación de fibras musculares."
    else:
        dictamen += "Zona de riesgo catabólico. Intenta dormir al menos 7 horas."

    # --- NUEVO: CÁLCULO DE DELTAS (Diferencias Biométricas) ---
    # Extraemos los objetos completos de las dos semanas
    bio_actual = biometrias[0]
    bio_pasada = biometrias[1]

    # Función interna de seguridad: Solo resta si el usuario llenó los datos opcionales
    def calcular_delta(val_actual, val_pasado):
        if val_actual is not None and val_pasado is not None:
            return round(val_actual - val_pasado, 2)
        return 0.0

    return {
        "analisis_semanal": dictamen,
        "deltas": {
            "peso": dif_peso, # Este ya lo teníamos calculado al principio de la función
            "grasa": calcular_delta(bio_actual.porcentaje_grasa, bio_pasada.porcentaje_grasa),
            "cintura": calcular_delta(bio_actual.perimetro_cintura, bio_pasada.perimetro_cintura),
            "brazo": calcular_delta(bio_actual.perimetro_brazo, bio_pasada.perimetro_brazo),
            "pierna": calcular_delta(bio_actual.perimetro_pierna, bio_pasada.perimetro_pierna)
        }
    }

# --- NUEVO: OBTENER HISTÓRICO TOTAL PARA GRÁFICAS DE TENDENCIA ---
@app.get("/api/biometria/historico/{usuario_id}")
def biometria_historico(usuario_id: int, db: Session = Depends(get_db)):
    # Buscamos todos los registros ordenados del más antiguo al más reciente
    registros = db.query(Biometria).filter(
        Biometria.usuario_id == usuario_id
    ).order_by(Biometria.fecha.asc()).all()
    
    if not registros:
        return {"error": "No hay historial suficiente."}

    # Estructuramos los datos para que Chart.js los lea de golpe
    # Usamos .strftime para que la fecha se vea limpia en la gráfica (Ej: 15 may)
    return {
        "fechas": [r.fecha.strftime("%d %b") for r in registros],
        "peso": [r.peso_corporal for r in registros],
        "grasa": [r.porcentaje_grasa for r in registros],
        "cintura": [r.perimetro_cintura for r in registros],
        "brazo": [r.perimetro_brazo for r in registros],
        "pierna": [r.perimetro_pierna for r in registros]
    }

