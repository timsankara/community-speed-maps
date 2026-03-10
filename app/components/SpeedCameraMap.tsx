"use client";

import { useState, useEffect } from "react";
import {
  APIProvider,
  Map,
  AdvancedMarker,
  useMap,
  InfoWindow,
} from "@vis.gl/react-google-maps";
import { supabase } from "@/lib/supabase";
import {
  MapPin,
  Flame,
  LocateFixed,
  MousePointerClick,
  Zap,
  Users,
  X,
  Menu,
  HelpCircle,
  Info,
} from "lucide-react";
import posthog from "posthog-js";

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

// --- Map Styling (Dark Monochrome) ---
const darkMonochromeMapStyles = [
  { elementType: "geometry", stylers: [{ color: "#212121" }] },
  { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#757575" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#212121" }] },
  {
    featureType: "administrative",
    elementType: "geometry",
    stylers: [{ color: "#757575" }],
  },
  {
    featureType: "administrative.country",
    elementType: "labels.text.fill",
    stylers: [{ color: "#9e9e9e" }],
  },
  {
    featureType: "administrative.locality",
    elementType: "labels.text.fill",
    stylers: [{ color: "#bdbdbd" }],
  },
  {
    featureType: "poi",
    elementType: "labels.text.fill",
    stylers: [{ color: "#757575" }],
  },
  {
    featureType: "poi.park",
    elementType: "geometry",
    stylers: [{ color: "#181818" }],
  },
  {
    featureType: "poi.park",
    elementType: "labels.text.fill",
    stylers: [{ color: "#616161" }],
  },
  {
    featureType: "poi.park",
    elementType: "labels.text.stroke",
    stylers: [{ color: "#1b1b1b" }],
  },
  {
    featureType: "road",
    elementType: "geometry.fill",
    stylers: [{ color: "#2c2c2c" }],
  },
  {
    featureType: "road",
    elementType: "labels.text.fill",
    stylers: [{ color: "#8a8a8a" }],
  },
  {
    featureType: "road.arterial",
    elementType: "geometry",
    stylers: [{ color: "#373737" }],
  },
  {
    featureType: "road.highway",
    elementType: "geometry",
    stylers: [{ color: "#3c3c3c" }],
  },
  {
    featureType: "road.highway.controlled_access",
    elementType: "geometry",
    stylers: [{ color: "#4e4e4e" }],
  },
  {
    featureType: "road.local",
    elementType: "labels.text.fill",
    stylers: [{ color: "#616161" }],
  },
  {
    featureType: "transit",
    elementType: "labels.text.fill",
    stylers: [{ color: "#757575" }],
  },
  {
    featureType: "water",
    elementType: "geometry",
    stylers: [{ color: "#000000" }],
  },
  {
    featureType: "water",
    elementType: "labels.text.fill",
    stylers: [{ color: "#3d3d3d" }],
  },
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
      map.setZoom(16);
      setTimeout(() => {
        map.panTo({ lat: selectedCamera.lat, lng: selectedCamera.lng });
      }, 50);
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

  const defaultCenter = { lat: -1.1873, lng: 36.9238 };

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
      let landmarkArea = "";

      for (const result of response.results) {
        if (result.types.includes("plus_code") && !plusCode) {
          plusCode = result.address_components[0].short_name;
        }
        if (!roadName) {
          const route = result.address_components.find((c) =>
            c.types.includes("route"),
          );
          if (route && route.long_name.length > 3) roadName = route.long_name;
        }
        if (!landmarkArea) {
          const area = result.address_components.find(
            (c) =>
              c.types.includes("neighborhood") ||
              c.types.includes("point_of_interest") ||
              c.types.includes("sublocality"),
          );
          if (area) landmarkArea = area.long_name;
        }
      }

      let finalName = "";
      if (roadName && landmarkArea && !roadName.includes(landmarkArea)) {
        finalName = `${roadName} (near ${landmarkArea})`;
      } else {
        finalName = roadName || landmarkArea || "Unknown Location";
      }

      if (plusCode) return `${plusCode} ${finalName}`;
      return finalName;
    } catch (error) {
      console.error("Geocoding failed:", error);
    }
    return "Unknown Location";
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
      if (posthog) {
        posthog.capture("camera_reported", {
          road_name: newMarker.road_name,
          has_speed_limit: !!speedLimit,
          speed_limit_value: speedLimit || "none",
        });
      }
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
      if (posthog) {
        posthog.capture("camera_edited", {
          camera_id: editingCamera.id,
          new_speed_limit: editSpeedLimit,
        });
      }
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
      if (posthog) {
        posthog.capture("camera_confirmed", {
          camera_id: nearbyCamera.id,
          road_name: nearbyCamera.road_name,
          added_speed: !!confirmSpeedLimit,
        });
      }
      setNewMarker(null);
      setNearbyCamera(null);
      setConfirmSpeedLimit("");
      fetchCameras();
    }
    setIsSubmitting(false);
  };

  const isMapIdle = !newMarker && !selectedCamera && !editingCamera;

  return (
    <div className="flex w-full h-screen overflow-hidden bg-slate-950 font-sans text-slate-200">
      {/* Mobile Menu Toggle */}
      <button
        onClick={() => setIsSidebarOpen(!isSidebarOpen)}
        className="md:hidden absolute top-6 left-6 z-40 bg-slate-900/90 backdrop-blur-xl p-3.5 rounded-2xl shadow-sm border border-slate-700/60 text-slate-300 hover:bg-slate-800 transition-all active:scale-95"
      >
        {isSidebarOpen ? (
          <X className="w-5 h-5" />
        ) : (
          <Menu className="w-5 h-5" />
        )}
      </button>

      {/* Sidebar - Ranked Cameras */}
      <div
        className={`absolute md:relative z-30 h-full w-80 bg-slate-900/80 backdrop-blur-2xl shadow-[4px_0_40px_rgba(0,0,0,0.5)] border-r border-slate-800/80 flex flex-col transform transition-transform duration-500 ease-out ${
          isSidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
      >
        <div className="p-8 border-b border-slate-800/80 bg-gradient-to-b from-slate-900/90 to-transparent">
          <h2 className="text-2xl font-bold text-white tracking-tight">
            Top Cameras
          </h2>
          <p className="text-sm text-slate-400 mt-1.5 font-medium">
            Ranked by community reports
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4 custom-scrollbar">
          {cameras.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-500">
              <MapPin className="w-12 h-12 mb-4 opacity-40" strokeWidth={1.5} />
              <p className="text-sm font-medium">No cameras reported yet.</p>
            </div>
          ) : (
            cameras.map((cam, index) => {
              const isTop = index < 3 && cam.report_count > 1;
              const { mainName, plusCode } = formatRoadName(cam.road_name);

              return (
                <div
                  key={cam.id}
                  className={`group p-5 rounded-[1.25rem] border ${
                    isTop
                      ? "border-amber-500/30 bg-gradient-to-br from-amber-500/10 to-orange-500/5"
                      : "border-slate-700/50 bg-slate-800/40"
                  } shadow-sm hover:shadow-md hover:border-blue-500/40 hover:bg-slate-800/60 transition-all duration-300 cursor-pointer`}
                  onClick={() => {
                    setSelectedCamera(cam);
                    setEditingCamera(null);
                    if (window.innerWidth < 768) setIsSidebarOpen(false);
                  }}
                >
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex-1 min-w-0 pr-3">
                      <h3 className="font-semibold text-white leading-snug flex items-start gap-2">
                        {isTop && (
                          <Flame className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                        )}
                        <div className="flex flex-col min-w-0">
                          <span className="truncate" title={mainName}>
                            {mainName}
                          </span>
                          {plusCode && (
                            <span className="text-[10px] font-mono text-slate-500 mt-0.5 tracking-wider uppercase truncate">
                              {plusCode}
                            </span>
                          )}
                        </div>
                      </h3>
                    </div>
                    <span
                      className={`shrink-0 text-xs font-bold px-2.5 py-1.5 rounded-lg border flex items-center gap-1 ${
                        isTop
                          ? "bg-amber-500/20 text-amber-400 border-amber-500/30"
                          : "bg-slate-700/50 text-slate-300 border-slate-600/50"
                      }`}
                    >
                      {cam.speed_limit ? (
                        `${cam.speed_limit} km/h`
                      ) : (
                        <HelpCircle className="w-3.5 h-3.5" />
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-[11px] font-semibold text-slate-500 mt-4 uppercase tracking-wider">
                    <span className="flex items-center gap-1.5">
                      <Info className="w-3.5 h-3.5 text-slate-600" />
                      {new Date(cam.created_at).toLocaleDateString()}
                    </span>
                    <span className="bg-slate-900/60 px-2.5 py-1.5 rounded-lg text-slate-400 flex items-center gap-1.5 shadow-sm border border-slate-700/50">
                      <Users className="w-3.5 h-3.5" />
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
        {isMapIdle && (
          <div className="absolute top-8 left-1/2 -translate-x-1/2 z-20 pointer-events-none transition-all duration-500 animate-in fade-in slide-in-from-top-6">
            <div className="bg-slate-800/90 backdrop-blur-xl text-white px-6 py-3 rounded-full shadow-[0_8px_30px_rgb(0,0,0,0.3)] border border-slate-700 flex items-center gap-3">
              <MousePointerClick className="w-4 h-4 text-blue-400 animate-pulse" />
              <span className="text-sm font-medium tracking-wide">
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
            styles={darkMonochromeMapStyles}
            onClick={handleMapClick}
            disableDefaultUI={true}
            gestureHandling={"greedy"}
          >
            <TrafficLayerFeature />
            <MapCameraHandler selectedCamera={selectedCamera} />

            {/* Existing Cameras */}
            {cameras.map((camera) => (
              <AdvancedMarker
                key={camera.id}
                position={{ lat: camera.lat, lng: camera.lng }}
                onClick={() => {
                  setSelectedCamera(camera);
                  setEditingCamera(null);
                  setNewMarker(null);
                  if (posthog) {
                    posthog.capture("camera_viewed", {
                      camera_id: camera.id,
                      road_name: camera.road_name,
                    });
                  }
                }}
              >
                <div className="relative flex flex-col items-center justify-center cursor-pointer group">
                  <div className="absolute -top-8 bg-slate-800/95 backdrop-blur-md text-white border border-slate-600 font-bold text-[11px] px-2.5 py-1 rounded-xl shadow-lg whitespace-nowrap z-10 transition-transform group-hover:scale-110 group-hover:-translate-y-1">
                    {camera.speed_limit ? `${camera.speed_limit}` : "??"}
                  </div>
                  <div className="bg-red-500/20 p-2 rounded-full">
                    <div className="bg-red-500 p-2 rounded-full shadow-[0_0_15px_rgba(239,68,68,0.5)] border-2 border-slate-900">
                      <MapPin
                        className="text-white w-4 h-4"
                        strokeWidth={2.5}
                      />
                    </div>
                  </div>
                </div>
              </AdvancedMarker>
            ))}

            {/* New Marker Placement */}
            {newMarker && (
              <AdvancedMarker position={newMarker}>
                <div className="relative flex flex-col items-center justify-center animate-bounce">
                  <div className="bg-blue-500/20 p-2 rounded-full">
                    <div className="bg-blue-500 p-2 rounded-full shadow-[0_0_15px_rgba(59,130,246,0.5)] border-2 border-slate-900">
                      <MapPin
                        className="text-white w-5 h-5"
                        strokeWidth={2.5}
                      />
                    </div>
                  </div>
                </div>
              </AdvancedMarker>
            )}

            {/* Info Window */}
            {selectedCamera && !editingCamera && (
              <InfoWindow
                position={{ lat: selectedCamera.lat, lng: selectedCamera.lng }}
                onCloseClick={() => setSelectedCamera(null)}
              >
                <div className="p-4 text-slate-200 min-w-[240px] font-sans !bg-slate-900 !rounded-xl">
                  {(() => {
                    const { mainName, plusCode } = formatRoadName(
                      selectedCamera.road_name,
                    );
                    return (
                      <>
                        <h3 className="font-bold text-lg leading-tight text-white">
                          {mainName}
                        </h3>
                        {plusCode && (
                          <p className="text-[11px] font-mono text-slate-400 mb-4 mt-1 tracking-widest">
                            {plusCode}
                          </p>
                        )}
                        {!plusCode && <div className="mb-4"></div>}
                      </>
                    );
                  })()}

                  <div className="flex gap-3 mb-2">
                    <span className="bg-blue-500/10 text-blue-400 text-xs font-semibold px-3 py-2 rounded-xl border border-blue-500/20 flex items-center gap-2">
                      <Zap className="w-3.5 h-3.5" />
                      {selectedCamera.speed_limit
                        ? `${selectedCamera.speed_limit} km/h`
                        : "Unknown"}
                    </span>
                    <span className="bg-slate-800 text-slate-300 text-xs font-semibold px-3 py-2 rounded-xl border border-slate-700 flex items-center gap-2">
                      <Users className="w-3.5 h-3.5" />
                      {selectedCamera.report_count} Reports
                    </span>
                  </div>

                  {/* <button
                    onClick={() => {
                      setEditingCamera(selectedCamera);
                      setSelectedCamera(null);
                    }}
                    className="w-full mt-4 bg-white text-slate-900 px-4 py-3 rounded-xl text-sm font-semibold hover:bg-slate-200 transition-all shadow-md active:scale-[0.98] flex justify-center items-center gap-2"
                  >
                    Update Speed Limit
                  </button>
                  */}
                </div>
              </InfoWindow>
            )}
          </Map>
        </APIProvider>

        {/* Repositioned "My Location" Button */}
        <button
          onClick={handleCurrentLocation}
          disabled={isFetchingLocation}
          className="absolute top-6 right-6 bg-slate-900/90 backdrop-blur-2xl px-4 py-4 rounded-2xl shadow-[0_8px_30px_rgba(0,0,0,0.3)] border border-slate-700/60 hover:bg-slate-800 active:scale-95 transition-all duration-300 z-20 flex items-center justify-center group"
          aria-label="My Location"
        >
          {isFetchingLocation ? (
            <div className="w-5 h-5 border-2 border-slate-600 border-t-white rounded-full animate-spin"></div>
          ) : (
            <LocateFixed className="w-5 h-5 text-slate-300 group-hover:text-blue-400 transition-colors" />
          )}
        </button>

        {/* MODAL 1: Dedicated Editing Modal (COMMENTED OUT FOR NOW) */}
        {/* {editingCamera && (
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 bg-slate-900/95 backdrop-blur-3xl p-7 rounded-[2rem] shadow-[0_20px_60px_-15px_rgba(0,0,0,0.5)] border border-slate-700/50 z-20 w-[92%] max-w-sm transition-all animate-in slide-in-from-bottom-12 duration-500">
            <div className="flex justify-between items-start mb-3">
              <h3 className="text-xl font-bold text-slate-900 tracking-tight">
                Update Camera
              </h3>
              <button
                onClick={() => setEditingCamera(null)}
                className="text-slate-400 hover:text-slate-900 bg-slate-50 hover:bg-slate-100 rounded-full p-2 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-sm text-slate-500 font-medium mb-6">
              {editingCamera.road_name}
            </p>

            <div className="space-y-5">
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-2 block">
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
                    className="w-full bg-slate-50/50 border border-slate-200/60 rounded-2xl p-4 text-slate-900 font-semibold focus:bg-white focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500/30 outline-none transition-all placeholder:font-medium placeholder:text-slate-400"
                    value={editSpeedLimit}
                    onChange={(e) => setEditSpeedLimit(e.target.value)}
                  />
                  <span className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-400 font-medium text-sm">
                    km/h
                  </span>
                </div>
              </div>

              <button
                onClick={handleEditCamera}
                disabled={isSubmitting}
                className="w-full bg-blue-600 text-white font-semibold py-4 rounded-2xl shadow-lg shadow-blue-500/20 hover:shadow-xl hover:shadow-blue-500/30 hover:bg-blue-700 active:scale-[0.98] transition-all disabled:opacity-70"
              >
                {isSubmitting ? "Updating..." : "Confirm Update"}
              </button>
            </div>
          </div>
        )}
        */}

        {/* MODAL 2: New Camera & Proximity Warning */}
        {newMarker && (
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 bg-slate-900/95 backdrop-blur-3xl p-7 rounded-[2rem] shadow-[0_20px_60px_-15px_rgba(0,0,0,0.5)] border border-slate-700/50 z-20 w-[92%] max-w-sm transition-all animate-in slide-in-from-bottom-12 duration-500">
            <div className="flex justify-between items-start mb-2">
              <h3 className="text-xl font-bold text-white tracking-tight">
                {nearbyCamera ? "Camera Nearby!" : "Report Camera"}
              </h3>
              <button
                onClick={() => {
                  setNewMarker(null);
                  setNearbyCamera(null);
                }}
                className="text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-full p-2 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {nearbyCamera ? (
              <div>
                <div className="bg-amber-500/10 border border-amber-500/30 p-4 rounded-2xl mb-5 mt-3">
                  {(() => {
                    const { mainName, plusCode } = formatRoadName(
                      nearbyCamera.road_name,
                    );
                    return (
                      <p className="text-sm text-amber-200/90 font-medium leading-relaxed">
                        A camera on{" "}
                        <strong className="font-bold text-amber-400">
                          {mainName}
                        </strong>
                        {plusCode && (
                          <span className="text-[10px] font-mono text-amber-500/70 ml-1">
                            {plusCode}
                          </span>
                        )}{" "}
                        is already reported just{" "}
                        <strong className="font-bold text-amber-400">
                          {nearbyDistance}m
                        </strong>{" "}
                        away.
                      </p>
                    );
                  })()}
                </div>

                {/* <div className="mb-6">
                  <label className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-2 block">
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
                      className="w-full bg-slate-800 border border-slate-700 rounded-2xl p-4 text-white font-semibold focus:bg-slate-700 focus:ring-4 focus:ring-amber-500/20 focus:border-amber-500/50 outline-none transition-all placeholder:font-medium placeholder:text-slate-500"
                      value={confirmSpeedLimit}
                      onChange={(e) => setConfirmSpeedLimit(e.target.value)}
                    />
                    <span className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-500 font-medium text-sm">
                      km/h
                    </span>
                  </div>
                </div>
                */}

                <div className="space-y-3 mt-4">
                  <button
                    onClick={confirmExistingCamera}
                    disabled={isSubmitting}
                    className="w-full bg-amber-500 text-white font-semibold py-4 rounded-2xl shadow-lg shadow-amber-500/20 hover:shadow-xl hover:bg-amber-600 active:scale-[0.98] transition-all disabled:opacity-70"
                  >
                    {isSubmitting ? "Confirming..." : "Confirm existing camera"}
                  </button>
                  <button
                    onClick={() => setNearbyCamera(null)}
                    className="w-full bg-slate-800 text-slate-300 font-semibold py-4 rounded-2xl hover:bg-slate-700 active:scale-[0.98] transition-all border border-slate-700"
                  >
                    No, this is a different camera
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <div className="flex items-start gap-3 mb-6 mt-3 bg-slate-800/80 p-4 rounded-2xl border border-slate-700">
                  <MapPin
                    className="text-blue-400 w-5 h-5 shrink-0"
                    strokeWidth={2}
                  />
                  {(() => {
                    const { mainName, plusCode } = formatRoadName(
                      newMarker.road_name,
                    );
                    return (
                      <div className="flex flex-col">
                        <span className="text-sm font-semibold text-slate-200 leading-tight">
                          {mainName}
                        </span>
                        {plusCode && (
                          <span className="text-[10px] font-mono text-slate-400 mt-0.5">
                            {plusCode}
                          </span>
                        )}
                      </div>
                    );
                  })()}
                </div>

                <div className="space-y-5">
                  <div>
                    <label className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-2 block">
                      Speed Limit (Optional)
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        placeholder="e.g. 50"
                        className="w-full bg-slate-800 border border-slate-700 rounded-2xl p-4 text-white font-semibold focus:bg-slate-700 focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500/50 outline-none transition-all placeholder:font-medium placeholder:text-slate-500"
                        value={speedLimit}
                        onChange={(e) => setSpeedLimit(e.target.value)}
                      />
                      <span className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-500 font-medium text-sm">
                        km/h
                      </span>
                    </div>
                  </div>

                  <button
                    onClick={handleSubmitCamera}
                    disabled={
                      isSubmitting || newMarker.road_name === "Locating road..."
                    }
                    className="w-full bg-blue-600 text-white font-semibold py-4 rounded-2xl shadow-lg shadow-blue-500/20 hover:shadow-xl hover:bg-blue-700 active:scale-[0.98] transition-all disabled:opacity-70 flex justify-center items-center"
                  >
                    {isSubmitting ? "Saving..." : "Confirm Camera"}
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
