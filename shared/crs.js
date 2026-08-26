(function(){
  const nad83Geog='GEOGCS["GCS_North_American_1983",DATUM["D_North_American_1983",SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';
  const crs=[
    {
      id:"EPSG:4326",label:"WGS 84 latitude / longitude",unit:"degrees",
      proj4:"+proj=longlat +datum=WGS84 +no_defs +type=crs",
      wkt:'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]'
    },
    {
      id:"EPSG:4269",label:"NAD 1983 latitude / longitude",unit:"degrees",
      proj4:"+proj=longlat +datum=NAD83 +no_defs +type=crs",
      wkt:nad83Geog
    },
    {
      id:"EPSG:3400",label:"NAD 1983 10TM AEP Forest",unit:"metres",
      proj4:"+proj=tmerc +lat_0=0 +lon_0=-115 +k=0.9992 +x_0=500000 +y_0=0 +ellps=GRS80 +datum=NAD83 +units=m +no_defs +type=crs",
      wkt:'PROJCS["NAD_1983_10TM_AEP_Forest",'+nad83Geog+',PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",-115.0],PARAMETER["Scale_Factor",0.9992],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]'
    },
    {
      id:"EPSG:26911",label:"NAD 1983 UTM Zone 11N",unit:"metres",
      proj4:"+proj=utm +zone=11 +datum=NAD83 +units=m +no_defs +type=crs",
      wkt:'PROJCS["NAD_1983_UTM_Zone_11N",'+nad83Geog+',PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",-117.0],PARAMETER["Scale_Factor",0.9996],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]'
    },
    {
      id:"EPSG:26912",label:"NAD 1983 UTM Zone 12N",unit:"metres",
      proj4:"+proj=utm +zone=12 +datum=NAD83 +units=m +no_defs +type=crs",
      wkt:'PROJCS["NAD_1983_UTM_Zone_12N",'+nad83Geog+',PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",-111.0],PARAMETER["Scale_Factor",0.9996],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]'
    },
    {
      id:"EPSG:3775",label:"NAD 1983 Alberta 3TM 111°W",unit:"metres",
      proj4:"+proj=tmerc +lat_0=0 +lon_0=-111 +k=0.9999 +x_0=0 +y_0=0 +datum=NAD83 +units=m +no_defs +type=crs",
      wkt:'PROJCS["NAD_1983_3TM_111",'+nad83Geog+',PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",0.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",-111.0],PARAMETER["Scale_Factor",0.9999],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]'
    },
    {
      id:"EPSG:3776",label:"NAD 1983 Alberta 3TM 114°W",unit:"metres",
      proj4:"+proj=tmerc +lat_0=0 +lon_0=-114 +k=0.9999 +x_0=0 +y_0=0 +datum=NAD83 +units=m +no_defs +type=crs",
      wkt:'PROJCS["NAD_1983_3TM_114",'+nad83Geog+',PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",0.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",-114.0],PARAMETER["Scale_Factor",0.9999],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]'
    },
    {
      id:"EPSG:3777",label:"NAD 1983 Alberta 3TM 117°W",unit:"metres",
      proj4:"+proj=tmerc +lat_0=0 +lon_0=-117 +k=0.9999 +x_0=0 +y_0=0 +datum=NAD83 +units=m +no_defs +type=crs",
      wkt:'PROJCS["NAD_1983_3TM_117",'+nad83Geog+',PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",0.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",-117.0],PARAMETER["Scale_Factor",0.9999],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]'
    }
  ];
  window.AGIS_CRS={list:crs,get:id=>crs.find(c=>c.id===id)||crs[0]};
})();
