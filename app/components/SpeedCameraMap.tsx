"use client";

import { useState, useEffect } from "react";
import {
  APIProvider,
  Map,
  AdvancedMarker,
  Pin,
  useMap,
  InfoWindow,
} from "@vis.gl/react-google-maps";
import { supabase } from "@/lib/supabase";

// --- Types ---
type SpeedCamera = {
  id: string;
  lat: number;
  lng: number;
  speed_limit: number | null;
  report_count: number;
  road_name: string;
  created_at: string;
};

type NewMarker = { lat: number; lng: number; road_name: string };

// --- Map Styling ---
const minimalMapStyles = [
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "landscape", stylers: [{ color: "#f3f4f6" }] },
  {
    featureType: "road.highway",
    elementType: "geometry",
    stylers: [{ color: "#ffffff" }],
  },
  {
    featureType: "road.arterial",
    elementType: "geometry",
    stylers: [{ color: "#ffffff" }],
  },
  { featureType: "water", stylers: [{ color: "#cbf0ff" }] },
];

// --- Helpers ---
const formatRoadName = (fullName: string) => {
  const match = fullName.match(/^([A-Z0-9]{2,8}\+[A-Z0-9]{2,3})\s*(.*)/);
  if (match) {
    let main = match[2]
      ? match[2].replace(/^[,\s]+/, "").trim()
      : "Unknown Road";
    if (!main) main = "Unknown Road";
    return { mainName: main, plusCode: match[1] };
  }
  return { mainName: fullName || "Unknown Road", plusCode: null };
};

const calculateDistanceKm = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
) => {
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

// --- Sub-Components ---
const TrafficLayerFeature = () => {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    const trafficLayer = new window.google.maps.TrafficLayer();
    trafficLayer.setMap(map);
    return () => trafficLayer.setMap(null);
  }, [map]);
  return null;
};

const MapCameraHandler = ({
  selectedCamera,
}: {
  selectedCamera: SpeedCamera | null;
}) => {
  const map = useMap();
  useEffect(() => {
    if (map && selectedCamera) {
      map.panTo({ lat: selectedCamera.lat, lng: selectedCamera.lng });
      map.setZoom(16);
    }
  }, [map, selectedCamera]);
  return null;
};

// --- Main Application Component ---
export default function SpeedCameraMap() {
  const [cameras, setCameras] = useState<SpeedCamera[]>([]);
  const [newMarker, setNewMarker] = useState<NewMarker | null>(null);

  const [selectedCamera, setSelectedCamera] = useState<SpeedCamera | null>(
    null,
  );
  const [editingCamera, setEditingCamera] = useState<SpeedCamera | null>(null);

  const [nearbyCamera, setNearbyCamera] = useState<SpeedCamera | null>(null);
  const [nearbyDistance, setNearbyDistance] = useState<number>(0);

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [speedLimit, setSpeedLimit] = useState<string>("");
  const [editSpeedLimit, setEditSpeedLimit] = useState<string>("");
  const [confirmSpeedLimit, setConfirmSpeedLimit] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isFetchingLocation, setIsFetchingLocation] = useState(false);

  const defaultCenter = { lat: -1.2921, lng: 36.8219 }; // Nairobi

  useEffect(() => {
    fetchCameras();
  }, []);

  const fetchCameras = async () => {
    const { data, error } = await supabase
      .from("speed_cameras")
      .select("*")
      .order("report_count", { ascending: false });
    if (!error) setCameras(data || []);
  };

  const getRoadName = async (lat: number, lng: number): Promise<string> => {
    const geocoder = new window.google.maps.Geocoder();
    try {
      const response = await geocoder.geocode({ location: { lat, lng } });

      let plusCode = "";
      let roadName = "";
      let localArea = "";

      for (const result of response.results) {
        if (result.types.includes("plus_code") && !plusCode) {
          plusCode = result.address_components[0].short_name;
          continue;
        }
        if (!roadName) {
          const route = result.address_components.find((c) =>
            c.types.includes("route"),
          );
          if (route) roadName = route.long_name;
        }
        if (!localArea) {
          const area = result.address_components.find(
            (c) =>
              c.types.includes("neighborhood") ||
              c.types.includes("sublocality") ||
              c.types.includes("point_of_interest") ||
              c.types.includes("locality"),
          );
          if (area) localArea = area.long_name;
        }
      }

      let finalName = "";
      if (roadName && localArea && !roadName.includes(localArea)) {
        finalName = `${roadName} (${localArea})`;
      } else if (roadName) {
        finalName = roadName;
      } else if (localArea) {
        finalName = localArea;
      } else {
        finalName = "Unknown Road";
      }

      if (plusCode) return `${plusCode} ${finalName}`;
      return finalName;
    } catch (error) {
      console.error("Geocoding failed:", error);
    }
    return "Unknown Road";
  };

  const checkProximity = (lat: number, lng: number) => {
    let closestCam: SpeedCamera | null = null;
    let minDistance = 0.5;

    cameras.forEach((cam) => {
      const dist = calculateDistanceKm(lat, lng, cam.lat, cam.lng);
      if (dist < minDistance) {
        minDistance = dist;
        closestCam = cam;
      }
    });

    if (closestCam) {
      setNearbyCamera(closestCam);
      setNearbyDistance(Math.round(minDistance * 1000));
    } else {
      setNearbyCamera(null);
    }
  };

  const handleMapClick = async (e: any) => {
    if (!e.detail.latLng || newMarker) return;

    const lat = e.detail.latLng.lat;
    const lng = e.detail.latLng.lng;

    setNewMarker({ lat, lng, road_name: "Locating road..." });
    setSelectedCamera(null);
    setEditingCamera(null);
    if (window.innerWidth < 768) setIsSidebarOpen(false);

    checkProximity(lat, lng);
    const roadName = await getRoadName(lat, lng);
    setNewMarker({ lat, lng, road_name: roadName });
  };

  const handleCurrentLocation = () => {
    if (!navigator.geolocation)
      return alert("Geolocation is not supported by your browser.");

    setIsFetchingLocation(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;

        setSelectedCamera(null);
        setEditingCamera(null);
        setNewMarker({ lat, lng, road_name: "Locating road..." });

        checkProximity(lat, lng);
        const roadName = await getRoadName(lat, lng);
        setNewMarker({ lat, lng, road_name: roadName });
        setIsFetchingLocation(false);
      },
      () => {
        alert("Could not fetch your location.");
        setIsFetchingLocation(false);
      },
    );
  };

  const handleSubmitCamera = async () => {
    if (!newMarker) return;
    setIsSubmitting(true);

    const cameraData = {
      lat: newMarker.lat,
      lng: newMarker.lng,
      speed_limit: speedLimit ? parseInt(speedLimit) : null,
      road_name: newMarker.road_name,
      report_count: 1,
    };

    const { error } = await supabase.from("speed_cameras").insert([cameraData]);
    if (!error) {
      setSpeedLimit("");
      setNewMarker(null);
      fetchCameras();
    }
    setIsSubmitting(false);
  };

  const handleEditCamera = async () => {
    if (!editingCamera) return;
    setIsSubmitting(true);

    const updates = {
      speed_limit: editSpeedLimit
        ? parseInt(editSpeedLimit)
        : editingCamera.speed_limit,
      report_count: editingCamera.report_count + 1,
    };

    const { error } = await supabase
      .from("speed_cameras")
      .update(updates)
      .eq("id", editingCamera.id);
    if (!error) {
      setEditingCamera(null);
      setEditSpeedLimit("");
      fetchCameras();
    }
    setIsSubmitting(false);
  };

  const confirmExistingCamera = async () => {
    if (!nearbyCamera) return;
    setIsSubmitting(true);

    const updates: any = { report_count: nearbyCamera.report_count + 1 };
    if (confirmSpeedLimit) {
      updates.speed_limit = parseInt(confirmSpeedLimit);
    }

    const { error } = await supabase
      .from("speed_cameras")
      .update(updates)
      .eq("id", nearbyCamera.id);

    if (!error) {
      setNewMarker(null);
      setNearbyCamera(null);
      setConfirmSpeedLimit("");
      fetchCameras();
    }
    setIsSubmitting(false);
  };

  // Helper boolean to know when the map is completely idle (no popups)
  const isMapIdle = !newMarker && !selectedCamera && !editingCamera;

  return (
    <div className="flex w-full h-screen overflow-hidden bg-gray-50 font-sans">
      {/* Mobile Menu Toggle */}
      <button
        onClick={() => setIsSidebarOpen(!isSidebarOpen)}
        className="md:hidden absolute top-4 left-4 z-40 bg-white/90 backdrop-blur-md p-3 rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.08)] border border-gray-100 text-gray-800 hover:bg-gray-50 transition active:scale-95"
      >
        <svg
          className="w-6 h-6"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d={
              isSidebarOpen ? "M6 18L18 6M6 6l12 12" : "M4 6h16M4 12h16M4 18h16"
            }
          ></path>
        </svg>
      </button>

      {/* Sidebar - Ranked Cameras */}
      <div
        className={`absolute md:relative z-30 h-full w-80 bg-white/95 backdrop-blur-2xl shadow-[4px_0_40px_rgba(0,0,0,0.06)] border-r border-gray-100/50 flex flex-col transform transition-transform duration-400 ease-out ${isSidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}`}
      >
        <div className="p-6 border-b border-gray-100 bg-gradient-to-b from-white to-gray-50/50">
          <h2 className="text-xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-gray-900 to-gray-600 tracking-tight">
            Top Cameras
          </h2>
          <p className="text-sm text-gray-500 mt-1 font-medium">
            Ranked by community reports
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
          {cameras.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-400">
              <span className="text-5xl mb-3 opacity-50">📍</span>
              <p className="text-sm font-medium">No cameras reported yet.</p>
            </div>
          ) : (
            cameras.map((cam, index) => {
              const { mainName, plusCode } = formatRoadName(cam.road_name);
              const isTop = index < 3 && cam.report_count > 1;

              return (
                <div
                  key={cam.id}
                  className={`group p-4 rounded-2xl border ${isTop ? "border-amber-200 bg-amber-50/30" : "border-gray-100 bg-white"} shadow-sm hover:shadow-md hover:border-blue-200 transition-all cursor-pointer`}
                  onClick={() => {
                    setSelectedCamera(cam);
                    setEditingCamera(null);
                    if (window.innerWidth < 768) setIsSidebarOpen(false);
                  }}
                >
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex-1 min-w-0 pr-2">
                      <h3
                        className="font-bold text-gray-800 truncate flex items-center gap-1.5"
                        title={mainName}
                      >
                        {isTop && (
                          <span
                            className="text-amber-500 text-sm"
                            title="Highly Reported"
                          >
                            🔥
                          </span>
                        )}
                        {mainName}
                      </h3>
                      {plusCode && (
                        <p className="text-[10.5px] font-mono text-gray-400 mt-0.5 tracking-wider uppercase">
                          {plusCode}
                        </p>
                      )}
                    </div>
                    <span
                      className={`shrink-0 text-xs font-bold px-2.5 py-1 rounded-full border ${isTop ? "bg-amber-100 text-amber-800 border-amber-200" : "bg-red-50 text-red-600 border-red-100"}`}
                    >
                      {cam.speed_limit ? `${cam.speed_limit} km/h` : "??"}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-[11px] font-semibold text-gray-500 mt-3 uppercase tracking-wider">
                    <span className="flex items-center gap-1">
                      <svg
                        className="w-3.5 h-3.5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                        ></path>
                      </svg>
                      {new Date(cam.created_at).toLocaleDateString()}
                    </span>
                    <span className="bg-gray-100/80 px-2 py-1 rounded-md text-gray-600 flex items-center gap-1">
                      <svg
                        className="w-3.5 h-3.5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                        ></path>
                      </svg>
                      {cam.report_count}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Main Map Area */}
      <div className="flex-1 relative h-full">
        {/* NEW: Smart Instruction Pill */}
        {isMapIdle && (
          <div className="absolute top-6 left-1/2 -translate-x-1/2 z-20 pointer-events-none transition-all duration-300 animate-in fade-in slide-in-from-top-4">
            <div className="bg-gray-900/90 backdrop-blur-md text-white px-5 py-2.5 rounded-full shadow-xl border border-gray-700/50 flex items-center gap-2.5">
              <span className="text-blue-400 animate-bounce">👇</span>
              <span className="text-sm font-semibold tracking-wide">
                Tap anywhere on map to report
              </span>
            </div>
          </div>
        )}

        <APIProvider apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!}>
          <Map
            defaultZoom={13}
            defaultCenter={defaultCenter}
            mapId={process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID || "DEMO_MAP_ID"}
            styles={minimalMapStyles}
            onClick={handleMapClick}
            disableDefaultUI={true}
            gestureHandling={"greedy"}
          >
            <TrafficLayerFeature />
            <MapCameraHandler selectedCamera={selectedCamera} />

            {cameras.map((camera) => (
              <AdvancedMarker
                key={camera.id}
                position={{ lat: camera.lat, lng: camera.lng }}
                onClick={() => {
                  setSelectedCamera(camera);
                  setEditingCamera(null);
                  setNewMarker(null);
                }}
              >
                <Pin
                  background={"#ef4444"}
                  borderColor={"#b91c1c"}
                  glyphColor={"#ffffff"}
                  scale={1.1}
                />
              </AdvancedMarker>
            ))}

            {newMarker && (
              <AdvancedMarker position={newMarker}>
                <Pin
                  background={"#3b82f6"}
                  borderColor={"#1d4ed8"}
                  glyphColor={"#ffffff"}
                  scale={1.2}
                />
              </AdvancedMarker>
            )}

            {selectedCamera && !editingCamera && (
              <InfoWindow
                position={{ lat: selectedCamera.lat, lng: selectedCamera.lng }}
                onCloseClick={() => setSelectedCamera(null)}
              >
                <div className="p-4 text-gray-800 min-w-[220px] font-sans">
                  {(() => {
                    const { mainName, plusCode } = formatRoadName(
                      selectedCamera.road_name,
                    );
                    return (
                      <>
                        <h3 className="font-extrabold text-lg leading-tight text-gray-900">
                          {mainName}
                        </h3>
                        {plusCode && (
                          <p className="text-xs font-mono text-gray-400 mb-3 mt-1 tracking-widest">
                            {plusCode}
                          </p>
                        )}
                        {!plusCode && <div className="mb-3"></div>}
                      </>
                    );
                  })()}

                  <div className="flex gap-2 mb-4">
                    <span className="bg-red-50 text-red-700 text-xs font-bold px-2.5 py-1.5 rounded-lg border border-red-100 flex items-center gap-1">
                      ⚡{" "}
                      {selectedCamera.speed_limit
                        ? `${selectedCamera.speed_limit} km/h`
                        : "Unknown"}
                    </span>
                    <span className="bg-gray-50 text-gray-600 text-xs font-bold px-2.5 py-1.5 rounded-lg border border-gray-100 flex items-center gap-1">
                      👥 {selectedCamera.report_count}
                    </span>
                  </div>

                  <button
                    onClick={() => {
                      setEditingCamera(selectedCamera);
                      setSelectedCamera(null);
                    }}
                    className="w-full bg-gradient-to-r from-gray-900 to-gray-800 text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:from-black hover:to-gray-900 transition-all shadow-md active:scale-95 flex justify-center items-center gap-2"
                  >
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                      ></path>
                    </svg>
                    Update Speed Limit
                  </button>
                </div>
              </InfoWindow>
            )}
          </Map>
        </APIProvider>

        {/* REDESIGNED: Clearer "My Location" Button */}
        <button
          onClick={handleCurrentLocation}
          disabled={isFetchingLocation}
          className="absolute bottom-8 right-6 bg-white/95 backdrop-blur-xl px-5 py-3.5 rounded-2xl shadow-[0_10px_40px_rgba(0,0,0,0.12)] border border-gray-100 hover:shadow-[0_10px_40px_rgba(0,0,0,0.18)] active:scale-95 transition-all duration-200 z-20 flex items-center gap-2.5 group"
        >
          {isFetchingLocation ? (
            <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
          ) : (
            <span className="text-xl group-hover:scale-110 transition-transform">
              🎯
            </span>
          )}
          <span className="font-bold text-gray-700 text-sm">My Location</span>
        </button>

        {/* MODAL 1: Dedicated Editing Modal */}
        {editingCamera && (
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 bg-white/95 backdrop-blur-2xl p-6 rounded-[2rem] shadow-[0_20px_60px_-15px_rgba(0,0,0,0.15)] border border-white z-20 w-[92%] max-w-sm transition-all animate-in slide-in-from-bottom-8 duration-300">
            <div className="flex justify-between items-start mb-2">
              <h3 className="text-xl font-extrabold text-gray-900">
                Update Camera
              </h3>
              <button
                onClick={() => setEditingCamera(null)}
                className="text-gray-400 hover:text-gray-900 bg-gray-50 hover:bg-gray-100 rounded-full p-1.5 transition-colors"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M6 18L18 6M6 6l12 12"
                  ></path>
                </svg>
              </button>
            </div>

            <p className="text-sm text-gray-500 font-medium mb-5">
              {formatRoadName(editingCamera.road_name).mainName}
            </p>

            <div className="space-y-4">
              <div>
                <label className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-1.5 block">
                  New Speed Limit
                </label>
                <div className="relative">
                  <input
                    type="number"
                    placeholder={
                      editingCamera.speed_limit
                        ? `Currently ${editingCamera.speed_limit}`
                        : "Enter new limit..."
                    }
                    className="w-full bg-gray-50/50 border border-gray-200 rounded-2xl p-4 text-gray-900 font-bold focus:bg-white focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all placeholder:font-medium"
                    value={editSpeedLimit}
                    onChange={(e) => setEditSpeedLimit(e.target.value)}
                  />
                  <span className="absolute right-5 top-1/2 -translate-y-1/2 text-gray-400 font-bold text-sm">
                    km/h
                  </span>
                </div>
              </div>

              <button
                onClick={handleEditCamera}
                disabled={isSubmitting}
                className="w-full bg-gradient-to-r from-blue-600 to-blue-500 text-white font-bold py-4 rounded-2xl shadow-lg shadow-blue-500/25 hover:shadow-xl hover:shadow-blue-500/30 active:scale-[0.98] transition-all disabled:opacity-70 flex justify-center items-center"
              >
                {isSubmitting ? "Updating Database..." : "Confirm Update"}
              </button>
            </div>
          </div>
        )}

        {/* MODAL 2: New Camera & Proximity Warning */}
        {newMarker && (
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 bg-white/95 backdrop-blur-2xl p-6 rounded-[2rem] shadow-[0_20px_60px_-15px_rgba(0,0,0,0.15)] border border-white z-20 w-[92%] max-w-sm transition-all animate-in slide-in-from-bottom-8 duration-300">
            <div className="flex justify-between items-start mb-2">
              <h3 className="text-xl font-extrabold text-gray-900">
                {nearbyCamera ? "Camera Nearby!" : "Report Camera"}
              </h3>
              <button
                onClick={() => {
                  setNewMarker(null);
                  setNearbyCamera(null);
                }}
                className="text-gray-400 hover:text-gray-900 bg-gray-50 hover:bg-gray-100 rounded-full p-1.5 transition-colors"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M6 18L18 6M6 6l12 12"
                  ></path>
                </svg>
              </button>
            </div>

            {nearbyCamera ? (
              // --- PROXIMITY WARNING UI ---
              <div>
                <div className="bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200/60 p-4 rounded-2xl mb-4 mt-2">
                  <p className="text-sm text-amber-900 font-medium leading-relaxed">
                    A camera on{" "}
                    <strong className="font-extrabold">
                      {formatRoadName(nearbyCamera.road_name).mainName}
                    </strong>{" "}
                    is already reported just{" "}
                    <strong className="font-extrabold">
                      {nearbyDistance}m
                    </strong>{" "}
                    away.
                  </p>
                </div>

                <div className="mb-5">
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-1.5 block">
                    Update Speed? (Optional)
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      placeholder={
                        nearbyCamera.speed_limit
                          ? `Currently ${nearbyCamera.speed_limit}`
                          : "e.g. 50"
                      }
                      className="w-full bg-gray-50/50 border border-gray-200 rounded-2xl p-4 text-gray-900 font-bold focus:bg-white focus:ring-4 focus:ring-amber-500/20 focus:border-amber-500 outline-none transition-all placeholder:font-medium"
                      value={confirmSpeedLimit}
                      onChange={(e) => setConfirmSpeedLimit(e.target.value)}
                    />
                    <span className="absolute right-5 top-1/2 -translate-y-1/2 text-gray-400 font-bold text-sm">
                      km/h
                    </span>
                  </div>
                </div>

                <div className="space-y-2.5">
                  <button
                    onClick={confirmExistingCamera}
                    disabled={isSubmitting}
                    className="w-full bg-gradient-to-r from-amber-500 to-orange-400 text-white font-bold py-4 rounded-2xl shadow-lg shadow-amber-500/25 hover:shadow-xl active:scale-[0.98] transition-all disabled:opacity-70"
                  >
                    {isSubmitting
                      ? "Confirming..."
                      : "Yes, confirm existing camera"}
                  </button>
                  <button
                    onClick={() => setNearbyCamera(null)}
                    className="w-full bg-gray-50 text-gray-600 font-bold py-4 rounded-2xl hover:bg-gray-100 active:scale-[0.98] transition-all"
                  >
                    No, this is a different camera
                  </button>
                </div>
              </div>
            ) : (
              // --- STANDARD ADD UI ---
              <div>
                <div className="flex items-start gap-2.5 mb-5 mt-2 bg-gray-50 p-3 rounded-2xl border border-gray-100">
                  <span className="text-blue-500 mt-0.5 text-lg drop-shadow-sm">
                    📍
                  </span>
                  {(() => {
                    const { mainName, plusCode } = formatRoadName(
                      newMarker.road_name,
                    );
                    return (
                      <div className="flex flex-col">
                        <span className="text-sm font-bold text-gray-800 leading-tight">
                          {mainName}
                        </span>
                        {plusCode && (
                          <span className="text-[10px] font-mono text-gray-400 mt-0.5">
                            {plusCode}
                          </span>
                        )}
                      </div>
                    );
                  })()}
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-1.5 block">
                      Speed Limit (Optional)
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        placeholder="e.g. 50"
                        className="w-full bg-gray-50/50 border border-gray-200 rounded-2xl p-4 text-gray-900 font-bold focus:bg-white focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all placeholder:font-medium"
                        value={speedLimit}
                        onChange={(e) => setSpeedLimit(e.target.value)}
                      />
                      <span className="absolute right-5 top-1/2 -translate-y-1/2 text-gray-400 font-bold text-sm">
                        km/h
                      </span>
                    </div>
                  </div>

                  <button
                    onClick={handleSubmitCamera}
                    disabled={
                      isSubmitting || newMarker.road_name === "Locating road..."
                    }
                    className="w-full bg-gradient-to-r from-blue-600 to-blue-500 text-white font-bold py-4 rounded-2xl shadow-lg shadow-blue-500/25 hover:shadow-xl hover:shadow-blue-500/30 active:scale-[0.98] transition-all disabled:opacity-70 flex justify-center items-center"
                  >
                    {isSubmitting ? "Saving to map..." : "Confirm Camera"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
