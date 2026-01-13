-- MySQL dump 10.13  Distrib 8.0.44, for Linux (x86_64)
--
-- Host: localhost    Database: property_boundaries
-- ------------------------------------------------------
-- Server version	8.0.44-0ubuntu0.22.04.2

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `land_ownerships`
--

DROP TABLE IF EXISTS `land_ownerships`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `land_ownerships` (
  `id` int NOT NULL AUTO_INCREMENT,
  `title_no` varchar(255) NOT NULL,
  `tenure` varchar(255) NOT NULL,
  `property_address` text,
  `district` varchar(255) DEFAULT NULL,
  `county` varchar(255) DEFAULT NULL,
  `region` varchar(255) DEFAULT NULL,
  `postcode` varchar(255) DEFAULT NULL,
  `multiple_address_indicator` varchar(255) DEFAULT NULL,
  `price_paid` varchar(255) DEFAULT NULL,
  `proprietor_name_1` text,
  `company_registration_no_1` varchar(255) DEFAULT NULL,
  `proprietor_category_1` varchar(255) DEFAULT NULL,
  `proprietor_1_address_1` text,
  `proprietor_1_address_2` text,
  `proprietor_1_address_3` text,
  `proprietor_name_2` text,
  `company_registration_no_2` varchar(255) DEFAULT NULL,
  `proprietor_category_2` varchar(255) DEFAULT NULL,
  `proprietor_2_address_1` text,
  `proprietor_2_address_2` text,
  `proprietor_2_address_3` text,
  `proprietor_name_3` text,
  `company_registration_no_3` varchar(255) DEFAULT NULL,
  `proprietor_category_3` varchar(255) DEFAULT NULL,
  `proprietor_3_address_1` text,
  `proprietor_3_address_2` text,
  `proprietor_3_address_3` text,
  `proprietor_name_4` text,
  `company_registration_no_4` varchar(255) DEFAULT NULL,
  `proprietor_category_4` varchar(255) DEFAULT NULL,
  `proprietor_4_address_1` text,
  `proprietor_4_address_2` text,
  `proprietor_4_address_3` text,
  `date_proprietor_added` date DEFAULT NULL,
  `additional_proprietor_indicator` varchar(255) DEFAULT NULL,
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP,
  `proprietor_uk_based` tinyint(1) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `title_no` (`title_no`),
  KEY `proprietor_name_1` (`proprietor_name_1`(255))
) ENGINE=InnoDB AUTO_INCREMENT=7810835 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `land_ownerships`
--
-- 

LOCK TABLES `land_ownerships` WRITE;
/*!40000 ALTER TABLE `land_ownerships` DISABLE KEYS */;
INSERT INTO `land_ownerships` VALUES (1,'ABC123','Leasehold','A Random place, Harrogate','NORTH YORKSHIRE','NORTH YORKSHIRE','YORKS AND HUMBER',NULL,'N',NULL,'54 North Homes Limited','12345','Limited Company or Public Limited Company','Somewhere',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'2000-03-30','N','2024-12-07 03:06:23','2024-12-07 03:06:23',1),(2,'DEF456','Freehold','Somewhere, Gateshead','GATESHEAD','TYNE AND WEAR','NORTH',NULL,'N','400000','3CHA Ltd','456789','Limited Company or Public Limited Company','Somewhere',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'2023-12-20','N','2024-12-07 03:14:49','2024-12-07 03:14:49',1);
/*!40000 ALTER TABLE `land_ownerships` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-01-13 17:12:19
